import {
    HandlerContext,
    HandlerResult,
    logger,
    Parameter,
    success,
    Tags,
} from "@atomist/automation-client";
import {CommandHandler} from "@atomist/automation-client/lib/decorators";
import {ResponderMessageClient} from "../../../context/QMMessageClient";
import {isSuccessCode} from "../../../http/Http";
import {GluonService} from "../../services/gluon/GluonService";
import {QMParamValidation} from "../../util/QMParamValidation";
import {
    GluonTeamOpenShiftCloudParam,
    GluonTeamOpenShiftCloudSetter,
} from "../../util/recursiveparam/GluonParameterSetters";
import {RecursiveParameterRequestCommand} from "../../util/recursiveparam/RecursiveParameterRequestCommand";
import {
    handleQMError,
    QMError,
    } from "../../util/shared/Error";
import {atomistIntent, CommandIntent} from "../CommandIntent";

@CommandHandler("Create a new team", atomistIntent(CommandIntent.CreateTeam))
@Tags("subatomic", "team")
export class CreateTeam extends RecursiveParameterRequestCommand implements GluonTeamOpenShiftCloudSetter {

    @GluonTeamOpenShiftCloudParam({
        callOrder: 0,
        selectionMessage: "",
    })
    public openShiftCloud: string;

    @Parameter({
        description: "team name",
        pattern: QMParamValidation.getPattern("CreateTeam", "teamName", ".{1,22}"),
        validInput: "between 1->22 characters",
    })
    public teamName: string;

    @Parameter({
        description: "team description",
    })
    private description: string;

    constructor(public gluonService = new GluonService()) {
        super();
    }

    public async runCommand(ctx: HandlerContext): Promise<HandlerResult> {
        logger.info(`Creating team for member: ${this.slackUserId}`);

        try {
            const member = await this.gluonService.members.gluonMemberFromSlackUserId(this.slackUserId);

            await this.createTeamInGluon(this.teamName, this.description, this.openShiftCloud, member.memberId);

            this.succeedCommand();
            return await success();
        } catch (error) {
            this.failCommand();
            return await this.handleError(ctx, error);
        }
    }

    private async createTeamInGluon(teamName: string, teamDescription: string, openShiftCloud: string, createdBy: string) {
        const teamCreationResult = await this.gluonService.teams.createTeam(teamName, teamDescription, openShiftCloud, createdBy);

        if (teamCreationResult.status === 409) {
            logger.error(`Failed to create team since the team name is already in use.`);
            throw new QMError(`Failed to create team since the team name is already in use. Please retry using a different team name.`);
        } else if (!isSuccessCode(teamCreationResult.status)) {
            logger.error(`Failed to create the team with name ${teamName}. Error: ${teamCreationResult.status}`);
            throw new QMError("Unable to create team.");
        }
    }

    private async handleError(ctx: HandlerContext, error) {
        return await handleQMError(new ResponderMessageClient(ctx), error);
    }

}
