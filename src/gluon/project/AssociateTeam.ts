import {
    CommandHandler,
    failure,
    HandlerContext,
    HandlerResult,
    logger,
    MappedParameter,
    MappedParameters,
    success,
} from "@atomist/automation-client";
import axios from "axios";
import * as _ from "lodash";
import {QMConfig} from "../../config/QMConfig";
import {gluonMemberFromScreenName} from "../member/Members";
import {
    handleQMError,
    QMError,
    ResponderMessageClient,
} from "../shared/Error";
import {
    RecursiveParameter,
    RecursiveParameterRequestCommand,
} from "../shared/RecursiveParameterRequestCommand";
import {
    gluonTeamForSlackTeamChannel,
    gluonTeamsWhoSlackScreenNameBelongsTo,
    menuForTeams,
} from "../team/Teams";
import {
    gluonProjectFromProjectName,
    gluonProjects,
    menuForProjects,
} from "./Projects";

@CommandHandler("Add additional team/s to a project", QMConfig.subatomic.commandPrefix + " associate team")
export class AssociateTeam extends RecursiveParameterRequestCommand {

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @MappedParameter(MappedParameters.SlackChannelName)
    public teamChannel: string;

    @RecursiveParameter({
        description: "team name",
        required: false,
        displayable: false,
    })
    public teamName: string;

    @RecursiveParameter({
        description: "project name",
        required: false,
        displayable: false,
    })
    public projectName: string;

    public constructor(projectName: string) {
        super();
        this.projectName = projectName;
    }

    protected async runCommand(ctx: HandlerContext) {
        try {
            await this.linkProjectForTeam(ctx, this.screenName, this.teamName);
        } catch (error) {
            return await this.handleError(ctx, error);
        }
    }

    protected async setNextParameter(ctx: HandlerContext): Promise<HandlerResult> {
        if (_.isEmpty(this.projectName)) {
            const projects = await gluonProjects(ctx);
            return await menuForProjects(
                ctx,
                projects,
                this,
                `Please select a project you would like to associate this team to.`,
            );
        }
        if (_.isEmpty(this.teamName)) {
            try {
                const team = await gluonTeamForSlackTeamChannel(this.teamChannel);
                this.teamName = team.name;
            } catch (error) {
                const teams = await gluonTeamsWhoSlackScreenNameBelongsTo(ctx, this.screenName);
                return await menuForTeams(
                    ctx,
                    teams,
                    this,
                    "Please select a team you would like to associate this project with",
                );
            }
        }
    }

    private async linkProjectForTeam(ctx: HandlerContext, screenName: string,
                                     teamName: string): Promise<any> {
        const member = await gluonMemberFromScreenName(ctx, screenName);
        const team = await axios.get(`${QMConfig.subatomic.gluon.baseUrl}/teams?name=${teamName}`);
logger.info("HERE");
        let gluonProject;
        try {
            logger.info(`${ctx},${this.projectName}`);
            gluonProject = await gluonProjectFromProjectName(ctx, this.projectName);
            logger.info(gluonProject);
        } catch (error) {
            return failure(error);
        }
        const updateGluonWithProjectDetails = await this.updateGluonProject(gluonProject.projectId, gluonProject.createdBy, team.data._embedded.teamResources[0].teamId, team.data._embedded.teamResources[0].name);
        logger.info(`!!!!${updateGluonWithProjectDetails}`);
        if (updateGluonWithProjectDetails.status === 201) {
            if (this.teamChannel !== team.data._embedded.teamResources[0].name) {
                return await ctx.messageClient.respond(`Team *${team.data._embedded.teamResources[0].name}* has been successfully associated with ${gluonProject.projectId}`);
            }
        } else {
            logger.error(`Failed to link project. Error ${updateGluonWithProjectDetails.data}`);
            throw new QMError(`❗Failed to link project.`);
        }

    }

    private async updateGluonProject(projectId: string, createdBy: string, teamId: string, name: string) {
        logger.info(`${projectId},${createdBy},${teamId},${name}`);
        return await axios.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`,
            {
                productId: `${projectId}`,
                createdBy: `${createdBy}`,
                teams: [{
                    teamId: `${teamId}`,
                    name: `${name}`,
                }],
            });
    }

    private async handleError(ctx: HandlerContext, error) {
        const messageClient = new ResponderMessageClient(ctx);
        return await handleQMError(messageClient, error);
    }
}
