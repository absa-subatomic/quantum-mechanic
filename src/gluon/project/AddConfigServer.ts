import {
    CommandHandler,
    HandleCommand,
    HandlerContext,
    HandlerResult,
    logger,
    MappedParameter,
    MappedParameters,
    Parameter,
    SuccessPromise,
} from "@atomist/automation-client";
import {menuForCommand} from "@atomist/automation-client/spi/message/MessageClient";
import {SlackMessage, url} from "@atomist/slack-messages";
import * as _ from "lodash";
import {QMConfig} from "../../config/QMConfig";
import {NamedSimpleOption} from "../../openshift/base/options/NamedSimpleOption";
import {SimpleOption} from "../../openshift/base/options/SimpleOption";
import {OCClient} from "../../openshift/OCClient";
import {OCCommon} from "../../openshift/OCCommon";
import {
    gluonTeamForSlackTeamChannel,
    gluonTeamsWhoSlackScreenNameBelongsTo, menuForTeams,
} from "../team/Teams";
import {gluonProjectsWhichBelongToGluonTeam, menuForProjects} from "./Projects";

@CommandHandler("Add a new Subatomic Config Server", QMConfig.subatomic.commandPrefix + " add config server")
export class AddConfigServer implements HandleCommand<HandlerResult> {

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @MappedParameter(MappedParameters.SlackChannelName)
    public teamChannel: string;

    @Parameter({
        description: "team name",
        required: false,
        displayable: false,
    })
    public gluonTeamName: string;

    @Parameter({
        description: "Remote Git repository URI",
    })
    public gitUri: string;

    public handle(ctx: HandlerContext): Promise<HandlerResult> {
        if (_.isEmpty(this.gluonTeamName)) {
            return this.requestUnsetParameters(ctx);
        }

        return this.addConfigServer(
            ctx,
            this.gluonTeamName,
            this.gitUri,
        );
    }

    private requestUnsetParameters(ctx: HandlerContext): Promise<HandlerResult> {
        if (_.isEmpty(this.gluonTeamName)) {
            return gluonTeamForSlackTeamChannel(this.teamChannel)
                .then(
                    team => {
                        this.gluonTeamName = team.name;
                        return this.requestUnsetParameters(ctx);
                    },
                    () => {
                        return gluonTeamsWhoSlackScreenNameBelongsTo(ctx, this.screenName).then(teams => {
                            return menuForTeams(
                                ctx,
                                teams,
                                this,
                                "Please select a team, whose DevOps project the Subatomic Config Server will be added to",
                                "gluonTeamName",
                            );
                        });
                    },
                );
        }
    }

    private addConfigServer(ctx: HandlerContext,
                            gluonTeamName: string,
                            gitUri: string): Promise<any> {
        const devOpsProjectId = `${_.kebabCase(gluonTeamName).toLowerCase()}-devops`;
        return OCCommon.commonCommand("create secret generic",
            "subatomic-config-server",
            [],
            [
                new NamedSimpleOption("-from-literal=spring.cloud.config.server.git.hostKey", QMConfig.subatomic.bitbucket.cicdKey),
                new NamedSimpleOption("-from-file=spring.cloud.config.server.git.privateKey", QMConfig.subatomic.bitbucket.cicdPrivateKeyPath),
                new SimpleOption("-namespace", devOpsProjectId),
            ])
            .catch(() => {
                logger.warn("Secret subatomic-config-server probably already exists");
                return SuccessPromise;
            })
            .then(() => {
                return OCCommon.createFromData({
                    apiVersion: "v1",
                    kind: "ConfigMap",
                    metadata: {
                        name: "subatomic-config-server",
                    },
                    data: {
                        "application.yml": `
spring:
  cloud:
    config:
      server:
        git:
          ignoreLocalSshSettings: true
          strictHostKeyChecking: false
          hostKeyAlgorithm: ssh-rsa
`,
                    },
                }, [
                    new SimpleOption("-namespace", devOpsProjectId),
                ]);
            })
            .then(() => {
                return OCCommon.commonCommand("tag",
                    "subatomic/subatomic-config-server:1.0",
                    [`${devOpsProjectId}/subatomic-config-server:1.0`],
                );
            })
            .then(() => {
                return OCClient.policy.addRoleToUser(
                    `system:serviceaccount:${devOpsProjectId}:default`,
                    "view",
                    devOpsProjectId);
            })
            .then(() => {
                const saneGitUri = _.replace(gitUri, /(<)|>/g, "");
                return OCCommon.commonCommand("process",
                    "subatomic-config-server-template",
                    [],
                    [
                        new SimpleOption("p", `GIT_URI=${saneGitUri}`),
                        new SimpleOption("p", `IMAGE_STREAM_PROJECT=${devOpsProjectId}`),
                        // TODO relook once we have a designed https://github.com/orgs/absa-subatomic/projects/2#card-7672800
                        new SimpleOption("p", `IMAGE_STREAM_TAG=1.0`),
                        new SimpleOption("-namespace", "subatomic"),
                    ],
                );
            })
            .then(appTemplate => {
                logger.debug(`Processed Subatomic Config Server Template: ${appTemplate.output}`);

                return OCCommon.commonCommand("get", `dc/subatomic-config-server`, [],
                    [
                        new SimpleOption("-namespace", devOpsProjectId),
                    ])
                    .then(() => {
                        logger.warn(`Subatomic Config Server Template has already been processed, deployment exists`);
                        return SuccessPromise;
                    }, () => {
                        return OCCommon.createFromData(JSON.parse(appTemplate.output),
                            [
                                new SimpleOption("-namespace", devOpsProjectId),
                            ]);
                    });
            })
            .then(() => {
                const slackMessage: SlackMessage = {
                    text: `Your Subatomic Config Server has been added to your *${devOpsProjectId}* OpenShift project successfully`,
                    attachments: [{
                        fallback: `Your Subatomic Config Server has been added successfully`,
                        footer: `For more information, please read the ${this.docs()}`,
                    }],
                };

                return ctx.messageClient.addressChannels(slackMessage, this.teamChannel);
            });
    }

    private docs(): string {
        return `${url(`${QMConfig.subatomic.docs.baseUrl}/config-server`,
            "documentation")}`;
    }
}
