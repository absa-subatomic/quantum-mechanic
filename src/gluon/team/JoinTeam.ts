import {
    CommandHandler,
    HandleCommand,
    HandlerContext,
    HandlerResult,
    logger,
    MappedParameter,
    MappedParameters,
    Parameter,
    Tags,
} from "@atomist/automation-client";
import {
    buttonForCommand,
    menuForCommand,
} from "@atomist/automation-client/spi/message/MessageClient";
import {inviteUserToSlackChannel} from "@atomist/lifecycle-automation/handlers/command/slack/AssociateRepo";
import {SlackMessage, url} from "@atomist/slack-messages";
import axios from "axios";
import * as _ from "lodash";
import {QMConfig} from "../../config/QMConfig";
import * as graphql from "../../typings/types";
import {ListTeamProjects} from "../project/ProjectDetails";
import {CreateTeam} from "./CreateTeam";

@CommandHandler("Apply to join an existing team", QMConfig.subatomic.commandPrefix + " apply to team")
@Tags("subatomic", "team")
export class JoinTeam implements HandleCommand<HandlerResult> {

    @MappedParameter(MappedParameters.SlackUser)
    public slackName: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {

        const teamsQueryResult = await axios.get(`${QMConfig.subatomic.gluon.baseUrl}/teams`);

        if (teamsQueryResult.status !== 200) {
            return this.alertUserThatNoTeamsExist(ctx);
        }

        const teams = teamsQueryResult.data._embedded.teamResources;
        logger.info(`Found teams data: ${JSON.stringify(teams)}`);

        // remove teams that he is already a member of - TODO in future

        return await this.presentMenuForTeamSelection(ctx, this.slackName, teams);
    }

    private async presentMenuForTeamSelection(ctx: HandlerContext, slackName: string, teams) {
        const msg: SlackMessage = {
            text: "Please select the team you would like to join",
            attachments: [{
                fallback: "Some buttons",
                actions: [
                    menuForCommand({
                            text: "Select Team", options:
                                teams.map(team => {
                                    return {
                                        value: team.teamId,
                                        text: team.name,
                                    };
                                }),
                        },
                        "CreateMembershipRequestToTeam", "teamId",
                        {slackName}),
                ],
            }],
        };

        return ctx.messageClient.addressUsers(msg, this.slackName);
    }

    private async alertUserThatNoTeamsExist(ctx: HandlerContext): Promise<HandlerResult> {
        const msg: SlackMessage = {
            text: `❗Unfortunately no teams have been created.`,
            attachments: [{
                fallback: "❗Unfortunately no teams have been created.",
                footer: `For more information, please read ${this.docs()}`,
                thumb_url: "https://raw.githubusercontent.com/absa-subatomic/subatomic-documentation/gh-pages/images/subatomic-logo-colour.png",
                actions: [
                    buttonForCommand(
                        {text: "Create a new team"},
                        new CreateTeam()),
                ],
            }],
        };
        return await ctx.messageClient.addressUsers(msg, this.slackName);
    }

    private docs(): string {
        return `${url(`${QMConfig.subatomic.docs.baseUrl}/quantum-mechanic/command-reference#create-team`,
            "documentation")}`;
    }
}

@CommandHandler("Add a member to a team", QMConfig.subatomic.commandPrefix + " add team member")
@Tags("subatomic", "team", "member")
export class AddMemberToTeam implements HandleCommand<HandlerResult> {

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @MappedParameter(MappedParameters.SlackTeam)
    public teamId: string;

    @MappedParameter(MappedParameters.SlackChannel)
    public channelId: string;

    @MappedParameter(MappedParameters.SlackChannelName)
    public teamChannel: string;

    @Parameter({
        description: "slack name of the member to add",
    })
    public slackName: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {
        logger.info(`Adding member [${this.slackName}] to team: ${this.teamChannel}`);

        const screenName = getScreenName(this.slackName);

        const chatId = await loadScreenNameByUserId(ctx, screenName);

        logger.info(`Got ChatId: ${chatId}`);

        const newMemberQueryResult = await axios.get(`${QMConfig.subatomic.gluon.baseUrl}/members?slackScreenName=${chatId}`);

        if (newMemberQueryResult.status !== 200) {
            return await alertGluonMemberForSlackMentionDoesNotExist(ctx, this.slackName, this.docs("onboard-me"));
        }

        const newMember = newMemberQueryResult.data._embedded.teamMemberResources[0];
logger.info(`!!!!${JSON.stringify(newMember)}`);
        if (!_.isEmpty(_.find(newMember.teams,
            (team: any) => team.slack.teamChannel === this.teamChannel))) {
            return ctx.messageClient.respond(`${newMember.slack.screenName} is already a member of this team.`);
        }

        logger.info(`Gluon member found: ${JSON.stringify(newMember)}`);

        logger.info(`Getting teams that ${this.screenName} (you) are a part of...`);

        const invokingMemberResult = await axios.get(`${QMConfig.subatomic.gluon.baseUrl}/members?slackScreenName=${this.screenName}`);
        if (invokingMemberResult.status !== 200) {
            return await ctx.messageClient.respond(`❗${this.screenName} does not appear to have been onboarded onto the Subatomic system`);
        }

        const actioningMember = invokingMemberResult.data._embedded.teamMemberResources[0];

        logger.info(`Got member's teams you belong to: ${JSON.stringify(actioningMember)}`);

        const teamSlackChannel = _.find(actioningMember.teams,
            (team: any) => team.slack.teamChannel === this.teamChannel);

        if (!_.isEmpty(teamSlackChannel)) {
            return await this.inviteUserToTeam(ctx, newMember, actioningMember, teamSlackChannel, this.channelId, this.screenName, this.teamId, this.teamChannel, this.slackName);
        } else {
            return await this.alertTeamDoesNotExist(ctx);
        }
    }

    private async inviteUserToTeam(ctx: HandlerContext, newMember, actioningMember, teamSlackChannel, channelId, screenName, teamId, teamChannel, slackName) {
        const newMemberId = newMember.memberId;
        logger.info(`Adding member [${newMemberId}] to team with ${JSON.stringify(teamSlackChannel._links.self.href)}`);

        const updateTeamResult = await axios.put(teamSlackChannel._links.self.href,
            {
                members: [{
                    memberId: newMemberId,
                }],
                createdBy: actioningMember.memberId,
            });

        if (updateTeamResult.status !== 201) {
            return await ctx.messageClient.respond(`❗Failed to add member to the team. Server side failure.`);
        }

        try {
            logger.info(`Added team member! Inviting to channel [${channelId}] -> member [${screenName}]`);

            await inviteUserToSlackChannel(ctx,
                teamId,
                channelId,
                screenName);

            return await this.welcomeMemberToTeam(ctx, newMember, teamSlackChannel, actioningMember, teamChannel);
        } catch (error) {
            return await ctx.messageClient.addressChannels(`User ${slackName} successfully added to your gluon team. Private channels do not currently support automatic user invitation.` +
                " Please invite the user to this slack channel manually.", teamChannel);
        }
    }

    private async welcomeMemberToTeam(ctx: HandlerContext, newMember, teamSlackChannel, actioningMember, teamChannel: string) {
        const msg: SlackMessage = {
            text: `Welcome to the team *${newMember.firstName}*!`,
            attachments: [{
                text: `
Welcome *${newMember.firstName}*, you have been added to the *${teamSlackChannel.name}* team by <@${actioningMember.slack.userId}>.
Click the button below to become familiar with the projects this team is involved in.
                                                                              `,
                fallback: `Welcome to the team ${newMember.firstName}`,
                footer: `For more information, please read the ${this.docs("list-projects")}`,
                mrkdwn_in: ["text"],
                thumb_url: "https://raw.githubusercontent.com/absa-subatomic/subatomic-documentation/gh-pages/images/subatomic-logo-colour.png",
                actions: [
                    buttonForCommand(
                        {text: "Show team projects"},
                        new ListTeamProjects()),
                ],
            }],
        };

        return await ctx.messageClient.addressChannels(msg, teamChannel);
    }

    private async alertTeamDoesNotExist(ctx: HandlerContext) {
        return await ctx.messageClient.respond({
            text: "This is not a team channel or not a team channel you belong to",
            attachments: [{
                text: `
This channel (*${this.teamChannel}*) is not a team channel for a team that you belong to.
You can only invite a new member to your team from a team channel that you belong to. Please retry this in one of those team channels.
                                                              `,
                color: "#D94649",
                mrkdwn_in: ["text"],
            }],
        });
    }

    private docs(extension): string {
        return `${url(`${QMConfig.subatomic.docs.baseUrl}/quantum-mechanic/command-reference#${extension}`,
            "documentation")}`;
    }
}

@CommandHandler("Request membership to a team")
@Tags("subatomic", "team", "member")
export class CreateMembershipRequestToTeam implements HandleCommand<HandlerResult> {

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @Parameter({
        description: "Gluon team id to create a membership request to.",
        displayable: false,

    })
    public teamId: string;

    @Parameter({
        description: "Slack name of the member to add.",
    })
    public slackName: string;

    public async handle(ctx: HandlerContext): Promise<HandlerResult> {
        logger.info(`Request to join team: ${this.teamId}`);

        const screenName = getScreenName(this.slackName);

        const chatId = await loadScreenNameByUserId(ctx, screenName);

        const newMemberQueryResult = await axios.get(`${QMConfig.subatomic.gluon.baseUrl}/members?slackScreenName=${chatId}`);

        if (newMemberQueryResult.status !== 200) {
            return await alertGluonMemberForSlackMentionDoesNotExist(ctx, this.slackName, this.docs("onboard-me"));
        }

        const updateTeamResult = await axios.put(`${QMConfig.subatomic.gluon.baseUrl}/teams/${this.teamId}`);

        if (updateTeamResult.status !== 201) {
            return await ctx.messageClient.respond(`❗Failed to add member to the team. Server side failure.`);
        }

        return await ctx.messageClient.respond("Your request to join then team has been sent.");
    }

    private docs(extension): string {
        return `${url(`${QMConfig.subatomic.docs.baseUrl}/quantum-mechanic/command-reference#${extension}`,
            "documentation")}`;
    }
}

async function alertGluonMemberForSlackMentionDoesNotExist(ctx: HandlerContext, slackName: string, docsLink: string) {
    return await ctx.messageClient.respond({
        text: `The Slack name you typed (${slackName}) does not appear to be a valid Slack user`,
        attachments: [{
            text: `
Adding a team member from Slack requires typing their \`@mention\` name or using their actual Slack screen name.
                                  `,
            fallback: `${slackName} is not onboarded onto Subatomic`,
            footer: `For more information, please read the ${docsLink}`,
            color: "#D94649",
            mrkdwn_in: ["text"],
            thumb_url: "https://raw.githubusercontent.com/absa-subatomic/subatomic-documentation/gh-pages/images/subatomic-logo-colour.png",
        }, {
            text: `Tip: You can get your Slack screen name by typing \`@atomist whoami\``,
            color: "#00a5ff",
            mrkdwn_in: ["text"],
        }],
    });
}

function getScreenName(screenName: string) {
    let result = screenName;
    if (screenName.startsWith("<@")) {
        result = _.replace(screenName, /(<@)|>/g, "");
    }
    return result;
}

async function loadScreenNameByUserId(ctx: HandlerContext, userId: string): Promise<string> {
    try {
        const result = await ctx.graphClient.executeQueryFromFile<graphql.ChatId.Query, graphql.ChatId.Variables>(
            "graphql/query/chatIdByUserId",
            {userId});

        if (result) {
            if (result.ChatId && result.ChatId.length > 0) {
                return result.ChatId[0].screenName;
            }
        }
    } catch (error) {
        logger.error("Error occurred running GraphQL query: %s", error);
    }
    return null;
}
