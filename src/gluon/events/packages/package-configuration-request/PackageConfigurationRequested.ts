import {
    buttonForCommand,
    EventFired,
    HandlerContext,
    HandlerResult,
    logger,
    success,
} from "@atomist/automation-client";
import {EventHandler} from "@atomist/automation-client/lib/decorators";
import {HandleEvent} from "@atomist/automation-client/lib/HandleEvent";
import {SlackMessage} from "@atomist/slack-messages";
import {QMConfig} from "../../../../config/QMConfig";
import {
    SimpleQMMessageClient,
} from "../../../../context/QMMessageClient";
import {ChannelMessageClient} from "../../../../context/QMMessageClient";
import {CommandIntent} from "../../../commands/CommandIntent";
import {KickOffJenkinsBuild} from "../../../commands/jenkins/JenkinsBuild";
import {DocumentationUrlBuilder} from "../../../messages/documentation/DocumentationUrlBuilder";
import {TeamMembershipMessages} from "../../../messages/member/TeamMembershipMessages";
import {GluonService} from "../../../services/gluon/GluonService";
import {ConfigurePackageDeploymentPipelineInJenkins} from "../../../tasks/packages/ConfigurePackageDeploymentPipelineInJenkins";
import {ConfigurePackageInOpenshift} from "../../../tasks/packages/ConfigurePackageInOpenshift";
import {ConfigurePackagePipelineInJenkins} from "../../../tasks/packages/ConfigurePackagePipelineInJenkins";
import {TaskListMessage} from "../../../tasks/TaskListMessage";
import {TaskRunner} from "../../../tasks/TaskRunner";
import {
    JenkinsDeploymentJobTemplate,
    NonProdDefaultJenkinsJobTemplate,
} from "../../../util/jenkins/JenkinsJobTemplates";
import {ApplicationType} from "../../../util/packages/Applications";
import {ParameterDisplayType} from "../../../util/recursiveparam/RecursiveParameterRequestCommand";
import {BaseQMEvent} from "../../../util/shared/BaseQMEvent";
import {
    handleQMError,
    QMError,
    } from "../../../util/shared/Error";
import {isUserAMemberOfTheTeam} from "../../../util/team/Teams";
import {QMApplication} from "../../../util/transform/types/gluon/Application";
import {QMMemberBase} from "../../../util/transform/types/gluon/Member";
import {QMProject} from "../../../util/transform/types/gluon/Project";
import {QMTeam} from "../../../util/transform/types/gluon/Team";
import {QMTenant} from "../../../util/transform/types/gluon/Tenant";
import {buildJenkinsDeploymentJobTemplates} from "./JenkinsDeploymentJobTemplateBuilder";
import {PackageConfigurationRequestedEvent} from "./PackageConfigurationRequestedEvent";

@EventHandler("Receive PackageConfigurationRequested events", `
subscription PackageConfigurationRequestedEvent {
  PackageConfigurationRequestedEvent {
    id
    application {
        name
    }
    project {
        name
    }
    s2iImage {
        imageName
        imageTag
    }
    openshiftTemplate
    jenkinsfileName
    buildEnvironmentVariables{
        key
        value
    }
    deploymentEnvironmentVariables{
        key
        value
    }
    actionedBy{
        firstName
        slackIdentity {
            screenName
            userId
        }
    }
  }
}
`)
export class PackageConfigurationRequested extends BaseQMEvent implements HandleEvent<any> {

    private membershipMessages: TeamMembershipMessages = new TeamMembershipMessages();

    constructor(private gluonService: GluonService = new GluonService()) {
        super();
    }

    public async handle(event: EventFired<any>, ctx: HandlerContext): Promise<HandlerResult> {
        logger.info(`Ingested PackageConfigurationRequested event: ${JSON.stringify(event.data)}`);
        const packageConfigurationRequestedEvent: PackageConfigurationRequestedEvent = event.data.PackageConfigurationRequestedEvent[0];
        const project: QMProject = await this.gluonService.projects.gluonProjectFromProjectName(packageConfigurationRequestedEvent.project.name);
        const messageClient: SimpleQMMessageClient = new ChannelMessageClient(ctx).addDestination(project.owningTeam.slack.teamChannel);
        try {

            await this.configurePackage(ctx, messageClient, packageConfigurationRequestedEvent);
            this.succeedEvent();
            return await success();
        } catch (error) {
            this.failEvent();
            return await handleQMError(messageClient, error);
        }
    }

    private async configurePackage(ctx: HandlerContext, messageClient: SimpleQMMessageClient, packageConfigurationEvent: PackageConfigurationRequestedEvent): Promise<HandlerResult> {
        const project: QMProject = await this.gluonService.projects.gluonProjectFromProjectName(packageConfigurationEvent.project.name);

        const application: QMApplication = await this.gluonService.applications.gluonApplicationForNameAndProjectName(packageConfigurationEvent.application.name, project.name);

        const member: QMMemberBase = await this.gluonService.members.gluonMemberFromSlackUserId(packageConfigurationEvent.actionedBy.slackIdentity.userId);

        const owningTeam: QMTeam = await this.gluonService.teams.getTeamById(project.owningTeam.teamId);

        const tenant: QMTenant = await this.gluonService.tenants.gluonTenantFromTenantId(project.owningTenant);

        if (!isUserAMemberOfTheTeam(member, owningTeam)) {
            throw new QMError("Actioning member is not a member of the team", this.membershipMessages.notAMemberOfTheTeam());
        }

        // Add OpenShift Configuration Jobs
        const taskListMessage = new TaskListMessage(`:rocket: Configuring package *${application.name}*...`, messageClient);
        const taskRunner = new TaskRunner(taskListMessage);
        if (application.applicationType === ApplicationType.DEPLOYABLE.toString()) {
            taskRunner.addTask(
                new ConfigurePackageInOpenshift(
                    {
                        buildEnvironmentVariables: packageConfigurationEvent.buildEnvironmentVariables,
                        openshiftTemplate: packageConfigurationEvent.openshiftTemplate,
                        baseS2IImage: packageConfigurationEvent.s2iImage,
                        deploymentEnvironmentVariables: packageConfigurationEvent.deploymentEnvironmentVariables,
                    },
                    {
                        teamName: project.owningTeam.name,
                        projectName: project.name,
                        packageName: application.name,
                        packageType: application.applicationType,
                        bitbucketRepoRemoteUrl: application.bitbucketRepository.remoteUrl,
                        owningTeamName: project.owningTeam.name,
                    },
                ),
                "Configure Package in OpenShift",
            );
        }

        // Add Jenkins build jobs
        const jenkinsJobTemplate = NonProdDefaultJenkinsJobTemplate;
        jenkinsJobTemplate.sourceJenkinsfile = packageConfigurationEvent.jenkinsfileName;

        taskRunner.addTask(
            new ConfigurePackagePipelineInJenkins(
                application,
                project,
                jenkinsJobTemplate),
            "Configure Package Build Jobs in Jenkins",
        );

        // Add Additional Jenkins Deployment jobs
        if (application.applicationType === ApplicationType.DEPLOYABLE.toString()) {
            const jenkinsDeploymentJobTemplates: JenkinsDeploymentJobTemplate[] = buildJenkinsDeploymentJobTemplates(
                tenant.name,
                project.name,
                project.devDeploymentPipeline,
                project.releaseDeploymentPipelines,
                QMConfig.subatomic.openshiftClouds[owningTeam.openShiftCloud].openshiftNonProd,
            );

            taskRunner.addTask(new ConfigurePackageDeploymentPipelineInJenkins(application, project, jenkinsDeploymentJobTemplates), "Configure Package Deployment Jobs in Jenkins");
        }

        await taskRunner.execute(ctx);

        return await this.sendPackageProvisionedMessage(messageClient, application.name, project.name, ApplicationType[application.applicationType]);

    }

    private async sendPackageProvisionedMessage(messageClient: SimpleQMMessageClient, applicationName: string, projectName: string, applicationType: ApplicationType) {

        const returnableSuccessMessage = this.getDefaultSuccessMessage(applicationName, projectName, applicationType);

        return await messageClient.send(returnableSuccessMessage);
    }

    private getDefaultSuccessMessage(applicationName: string, projectName: string, applicationType: ApplicationType): SlackMessage {
        let packageTypeString = "application";
        if (applicationType === ApplicationType.LIBRARY) {
            packageTypeString = "library";
        }

        return {
            text: `Your ${packageTypeString} *${applicationName}*, in project *${projectName}*, has been provisioned successfully ` +
                "and is ready to build/deploy",
            attachments: [{
                fallback: `Your ${packageTypeString} has been provisioned successfully`,
                footer: `For more information, please read the ${DocumentationUrlBuilder.commandReference(CommandIntent.KickOffJenkinsBuild)}`,
                text: `
You can kick off the build pipeline for your ${packageTypeString} by clicking the button below or pushing changes to your ${packageTypeString}'s repository`,
                mrkdwn_in: ["text"],
                actions: [
                    buttonForCommand(
                        {
                            text: "Start build",
                            style: "primary",
                        },
                        new KickOffJenkinsBuild(),
                        {
                            projectName,
                            applicationName,
                            displayResultMenu: ParameterDisplayType.hide,
                        }),
                ],
            }],
        };
    }
}
