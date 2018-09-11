import {
    CommandHandler,
    HandlerContext,
    MappedParameter,
    MappedParameters,
    Tags,
} from "@atomist/automation-client";
import {SlackMessage} from "@atomist/slack-messages";
import {QMConfig} from "../../../config/QMConfig";
import {AwaitAxios} from "../../../http/AwaitAxios";
import {GluonService} from "../../services/gluon/GluonService";
import {
    GluonTeamNameSetter,
    setGluonTeamName,
} from "../../util/recursiveparam/GluonParameterSetters";
import {
    RecursiveParameter,
    RecursiveParameterRequestCommand,
} from "../../util/recursiveparam/RecursiveParameterRequestCommand";

@CommandHandler("List members of a team", QMConfig.subatomic.commandPrefix + " list team members")
@Tags("subatomic", "slack", "channel", "team")
export class ListTeamMembers extends RecursiveParameterRequestCommand
    implements GluonTeamNameSetter {

    private static RecursiveKeys = {
        teamName: "TEAM_NAME",
    };

    @MappedParameter(MappedParameters.SlackUserName)
    public screenName: string;

    @MappedParameter(MappedParameters.SlackTeam)
    public teamId: string;

    @RecursiveParameter({
        recursiveKey: ListTeamMembers.RecursiveKeys.teamName,
        selectionMessage: "Please select the team you would like to list the members of",
    })
    public teamName: string;

    constructor(public gluonService = new GluonService(),
                public axiosInstance = new AwaitAxios()) {
        super();
    }

    protected async runCommand(ctx: HandlerContext) {
        const result = await this.axiosInstance.get(`${QMConfig.subatomic.gluon.baseUrl}/teams/?name=${this.teamName}`);

        const teamDetails = result.data._embedded.teamResources[0];
        const teamOwners = this.getTeamMemberNames(teamDetails.owners);
        const teamMembers = this.getTeamMemberNames(teamDetails.members);

        const msg: SlackMessage = {
            text: `Team Owners: ${teamOwners}`,
            attachments: [{
                fallback: `Team Owners:${teamOwners}`,
                text: `Team Members:${teamMembers}`,
                color: "#00ddff",
                mrkdwn_in: ["text"],
            }],
        };

        return await ctx.messageClient.respond(msg);
    }
    protected configureParameterSetters() {
        this.addRecursiveSetter(ListTeamMembers.RecursiveKeys.teamName, setGluonTeamName);
    }

    private getTeamMemberNames(teamDetails: any): string[] {
        const teamMemberNames = new Array();

        for (const member of teamDetails) {
            teamMemberNames.push(` *${member.slack.screenName}*`);
        }

        return teamMemberNames;
    }
}
