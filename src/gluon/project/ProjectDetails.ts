import {
    CommandHandler,
    HandleCommand,
    HandlerContext,
    HandlerResult,
    MappedParameter,
    MappedParameters,
    Parameter, success,
} from "@atomist/automation-client";
import {buttonForCommand} from "@atomist/automation-client/spi/message/MessageClient";
import {SlackMessage} from "@atomist/slack-messages";
import _ = require("lodash");
import {QMConfig} from "../../config/QMConfig";
import {gluonApplicationsLinkedToGluonProjectId} from "../packages/Applications";
import {logErrorAndReturnSuccess} from "../shared/Error";
import {
    gluonTeamForSlackTeamChannel,
    gluonTeamsWhoSlackScreenNameBelongsTo,
    menuForTeams,
} from "../team/Teams";
import {gluonProjectsWhichBelongToGluonTeam} from "./Projects";

@CommandHandler("List projects belonging to a team", QMConfig.subatomic.commandPrefix + " list projects")
export class ListTeamProjects implements HandleCommand<HandlerResult> {

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @MappedParameter(MappedParameters.SlackChannelName)
    public teamChannel: string;

    @Parameter({
        description: "team name",
        required: false,
        displayable: false,
    })
    public teamName: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {
        if (_.isEmpty(this.teamName)) {
            return await this.requestUnsetParameters(ctx);
        }

        return await this.listTeamProjects(ctx, this.teamName);

    }

    private async requestUnsetParameters(ctx: HandlerContext): Promise<HandlerResult> {
        if (_.isEmpty(this.teamName)) {
            try {
                const team = await gluonTeamForSlackTeamChannel(this.teamChannel);
                this.teamName = team.name;
                return await this.requestUnsetParameters(ctx);
            } catch (error) {
                const teams = await gluonTeamsWhoSlackScreenNameBelongsTo(ctx, this.screenName);
                return await menuForTeams(
                    ctx,
                    teams,
                    this,
                    "Please select a team you wish to list associated projects for",
                );
            }
        }
        return await success();
    }

    private async listTeamProjects(ctx: HandlerContext, teamName: string): Promise<HandlerResult> {
        let projects;
        try {
            projects = await gluonProjectsWhichBelongToGluonTeam(ctx, teamName);
        } catch (error) {
            return await logErrorAndReturnSuccess(gluonProjectsWhichBelongToGluonTeam.name, error);
        }
        const attachments = [];

        for (const project of projects) {

            const parameters = {
                projectId: project.projectId,
                projectName: project.name,
                projectDescription: project.description,
                projectBitbucketKey: null,
            };

            if (project.bitbucketProject !== null) {
                parameters.projectBitbucketKey = project.bitbucketProject.key;
            }

            attachments.push(
                {
                    text: `*Project:* ${project.name}\n*Description:* ${project.description}`,
                    color: "#45B254",
                    actions: [
                        buttonForCommand(
                            {
                                text: "Show More",
                            },
                            new ListProjectDetails(),
                            parameters,
                        ),
                    ],
                },
            );
        }

        const msg: SlackMessage = {
            text: `The following projects are linked to the team *${teamName}*. Click on the "Show More" button to learn more about a particular project.`,
            attachments,
        };

        return await ctx.messageClient.respond(msg);
    }

}

@CommandHandler("List project details")
export class ListProjectDetails implements HandleCommand<HandlerResult> {

    @Parameter({
        description: "project",
        required: false,
        displayable: false,
    })
    public projectId: string;

    @Parameter({
        description: "project",
        required: false,
        displayable: false,
    })
    public projectName: string;

    @Parameter({
        description: "project",
        required: false,
        displayable: false,
    })
    public projectDescription: string;

    @Parameter({
        description: "project",
        required: false,
        displayable: false,
    })
    public projectBitbucketKey: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {

        let applications;
        try {
            applications = gluonApplicationsLinkedToGluonProjectId(this.projectId);
        } catch (error) {
            return await logErrorAndReturnSuccess(gluonApplicationsLinkedToGluonProjectId.name, error);
        }

        let bitbucketURL = "None";
        if (this.projectBitbucketKey !== null) {
            bitbucketURL = `${QMConfig.subatomic.bitbucket.baseUrl}/projects/${this.projectBitbucketKey}`;
        }
        const attachments = [];
        for (const application of applications) {
            let applicationBitbucketUrl = "None";
            if (application.bitbucketRepository !== null) {
                applicationBitbucketUrl = application.bitbucketRepository.repoUrl;
            }
            attachments.push(
                {
                    text: `*Application:* ${application.name}\n*Description:* ${application.description}\n*Bitbucket URL:* ${applicationBitbucketUrl}`,
                    color: "#45B254",
                },
            );
        }

        let headerMessage = `The current details of the project *${this.projectName}* are as follows.\n*Description:* ${this.projectDescription}\n*Bitbucket URL:* ${bitbucketURL}\n`;

        if (attachments.length > 0) {
            headerMessage += "The below applications belong to the project:";
        } else {
            headerMessage += "There are no applications that belong to this project yet";
        }

        const msg: SlackMessage = {
            text: headerMessage,
            attachments,
        };
        return await ctx.messageClient.respond(msg);
    }
}
