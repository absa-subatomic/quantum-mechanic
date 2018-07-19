import {
    HandleCommand,
    HandlerContext,
    logger,
} from "@atomist/automation-client";
import {buttonForCommand} from "@atomist/automation-client/spi/message/MessageClient";
import axios from "axios";
import * as _ from "lodash";
import {QMConfig} from "../../../config/QMConfig";
import {CreateTeam} from "../../commands/team/CreateTeam";
import {JoinTeam} from "../../commands/team/JoinTeam";
import {createMenu} from "../shared/GenericMenu";

export class TeamService {
    public gluonTeamsWhoSlackScreenNameBelongsTo(ctx: HandlerContext, screenName: string): Promise<any[]> {
        logger.debug(`Trying to get gluon teams associated to a screenName. screenName: ${screenName} `);
        return axios.get(`${QMConfig.subatomic.gluon.baseUrl}/teams?slackScreenName=${screenName}`)
            .then(teams => {
                if (!_.isEmpty(teams.data._embedded)) {
                    return Promise.resolve(teams.data._embedded.teamResources);
                }

                return ctx.messageClient.respond({
                    // TODO this message should be customisable, as this function is used elsewhere
                    text: "Unfortunately, you are not a member of any team. To associate this project you need to be a member of at least one team.",
                    attachments: [{
                        text: "You can either create a new team or apply to join an existing team",
                        actions: [
                            // TODO add support for this later
                            buttonForCommand(
                                {
                                    text: "Apply to join a team",
                                    style: "primary",
                                },
                                new JoinTeam()),
                            buttonForCommand(
                                {text: "Create a new team"},
                                new CreateTeam()),
                        ],
                    }],
                })
                    .then(() => Promise.reject(`${screenName} does not belong to any team`));
            });
    }

    public gluonTeamForSlackTeamChannel(teamChannel: string): Promise<any> {
        logger.debug(`Trying to get gluon team associated to a teamChannel. teamChannel: ${teamChannel} `);
        return axios.get(`${QMConfig.subatomic.gluon.baseUrl}/teams?slackTeamChannel=${teamChannel}`)
            .then(teams => {
                if (!_.isEmpty(teams.data._embedded)) {
                    if (teams.data._embedded.teamResources.length === 1) {
                        return Promise.resolve(teams.data._embedded.teamResources[0]);
                    } else {
                        throw new RangeError("Multiple teams associated with the same Slack team channel is not expected");
                    }
                } else {
                    return Promise.reject(`No team associated with Slack team channel: ${teamChannel}`);
                }
            });
    }

    public async createGluonTeam(teamName: string, teamDescription: string, createdBy: string): Promise<any> {
        return await axios.post(`${QMConfig.subatomic.gluon.baseUrl}/teams`, {
            name: teamName,
            description: teamDescription,
            createdBy,
        });
    }

    public async addSlackDetailsToTeam(teamId: string, slackDetails: any): Promise<any> {
        return await axios.put(`${QMConfig.subatomic.gluon.baseUrl}/teams/${teamId}`, slackDetails);
    }

    public async addMemberToTeam(teamId: string, memberDetails: any): Promise<any> {
        return await axios.put(teamId,
            memberDetails);
    }

    public async createMembershipRequest(teamId: string, membershipRequestDetails: any): Promise<any> {
        return await axios.put(`${QMConfig.subatomic.gluon.baseUrl}/teams/${teamId}`,
            membershipRequestDetails);
    }

    public async requestDevOpsEnvironment(teamId: string, memberId: string): Promise<any> {
        return await axios.put(`${QMConfig.subatomic.gluon.baseUrl}/teams/${teamId}`,
            {
                devOpsEnvironment: {
                    requestedBy: memberId,
                },
            });
    }
}

export function menuForTeams(ctx: HandlerContext, teams: any[],
                             command: HandleCommand, message: string = "Please select a team",
                             projectNameVariable: string = "teamName"): Promise<any> {
    return createMenu(ctx,
        teams.map(team => {
            return {
                value: team.name,
                text: team.name,
            };
        }),
        command,
        message,
        "Select Team",
        projectNameVariable,
    );
}
