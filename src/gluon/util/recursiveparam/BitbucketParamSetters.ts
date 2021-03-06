import {
    HandlerContext,
    HandlerResult,
    logger,
} from "@atomist/automation-client";
import * as _ from "lodash";
import {QMConfig} from "../../../config/QMConfig";
import {BitbucketService} from "../../services/bitbucket/BitbucketService";
import {GluonService} from "../../services/gluon/GluonService";
import {menuAttachmentForBitbucketRepositories} from "../bitbucket/Bitbucket";
import {QMError} from "../shared/Error";
import {
    RecursiveParameter,
    RecursiveParameterDetails,
} from "./RecursiveParameterRequestCommand";
import {RecursiveSetterResult} from "./RecursiveSetterResult";

export async function setBitbucketRepository(ctx: HandlerContext, commandHandler: BitbucketRepoSetter, selectionMessage: string): Promise<RecursiveSetterResult> {
    const project = await commandHandler.gluonService.projects.gluonProjectFromProjectName(commandHandler.projectName);
    if (_.isEmpty(project.bitbucketProject)) {
        throw new QMError(`The selected project does not have an associated bitbucket project. Please first associate a bitbucket project using the \`${QMConfig.subatomic.commandPrefix} link bitbucket project\` command.`);
    }

    const bitbucketRepos = await commandHandler.bitbucketService.bitbucketRepositoriesForProjectKey(project.bitbucketProject.key);

    logger.debug(`Bitbucket project [${project.bitbucketProject.name}] has repositories: ${JSON.stringify(bitbucketRepos)}`);

    return {
        setterSuccess: false,
        messagePrompt: menuAttachmentForBitbucketRepositories(
            ctx,
            bitbucketRepos,
            commandHandler,
            selectionMessage,
            "bitbucketRepositorySlug",
            "https://raw.githubusercontent.com/absa-subatomic/subatomic-documentation/gh-pages/images/atlassian-bitbucket-logo.png",
        ),
    };
}

export interface BitbucketRepoSetter {
    gluonService: GluonService;
    bitbucketService: BitbucketService;
    projectName: string;
    bitbucketRepositorySlug: string;
    handle: (ctx: HandlerContext) => Promise<HandlerResult>;
}

export function BitbucketRepositoryParam(details: RecursiveParameterDetails) {
    details.setter = setBitbucketRepository;
    return RecursiveParameter(details);
}
