import {logger} from "@atomist/automation-client";
import {buttonForCommand} from "@atomist/automation-client/lib/spi/message/MessageClient";
import {SlackMessage} from "@atomist/slack-messages";
import _ = require("lodash");
import {QMConfig} from "../../../config/QMConfig";
import {AwaitAxios} from "../../../http/AwaitAxios";
import {isSuccessCode} from "../../../http/Http";
import {CommandIntent} from "../../commands/CommandIntent";
import {CreateProject} from "../../commands/project/CreateProject";
import {DocumentationUrlBuilder} from "../../messages/documentation/DocumentationUrlBuilder";
import {QMColours} from "../../util/QMColour";
import {QMError} from "../../util/shared/Error";
import {QMDeploymentPipeline} from "../../util/transform/types/gluon/Project";

export class ProjectService {

    constructor(public axiosInstance = new AwaitAxios()) {
    }

    public async gluonProjectFromProjectName(projectName: string,
                                             requestActionOnFailure: boolean = true, rawResult = false): Promise<any> {
        logger.debug(`Trying to get gluon project by projectName. projectName: ${projectName} `);

        const result = await this.axiosInstance.get(`${QMConfig.subatomic.gluon.baseUrl}/projects?name=${projectName}`);

        if (rawResult) {
            return result;
        } else if (!isSuccessCode(result.status) || _.isEmpty(result.data._embedded)) {
            const errorMessage = `Project with name ${projectName} does not exist`;
            if (requestActionOnFailure) {
                const slackMessage: SlackMessage = {
                    text: "This command requires an existing project",
                    attachments: [{
                        text: `
Unfortunately Subatomic does not manage this project.
Consider creating a new project called ${projectName}. Click the button below to do that now.
                            `,
                        fallback: "Project not managed by Subatomic",
                        footer: `For more information, please read the ${DocumentationUrlBuilder.commandReference(CommandIntent.CreateProject)}`,
                        color: QMColours.stdMuddyYellow.hex,
                        mrkdwn_in: ["text"],
                        actions: [
                            buttonForCommand(
                                {
                                    text: "Create project",
                                },
                                new CreateProject(), {
                                    name: projectName,
                                }),
                        ],
                    }],
                };

                throw new QMError(errorMessage, slackMessage);
            } else {
                throw new QMError(errorMessage);
            }
        }

        return result.data._embedded.projectResources[0];
    }

    public async gluonProjectsWhichBelongToGluonTeam(teamName: string, promptToCreateIfNoProjects = true): Promise<any[]> {
        logger.debug(`Trying to get gluon projects associated to team. teamName: ${teamName} `);

        const result = await this.axiosInstance.get(`${QMConfig.subatomic.gluon.baseUrl}/projects?teamName=${teamName}`);

        if (!isSuccessCode(result.status)) {
            throw new QMError(`Failed to get project associated to ${teamName}`);
        }

        let returnValue = [];

        if (!_.isEmpty(result.data._embedded)) {
            returnValue = result.data._embedded.projectResources;
        } else if (promptToCreateIfNoProjects) {
            const slackMessage: SlackMessage = {
                text: "Unfortunately there are no projects linked to this team.",
                attachments: [{
                    text: "Would you like to create a new project?",
                    fallback: "Would you like to create a new project?",
                    actions: [
                        buttonForCommand(
                            {
                                text: "Create project",
                            },
                            new CreateProject()),
                    ],
                }],
            };
            throw new QMError(`No projects associated to ${teamName}`, slackMessage);
        }

        return returnValue;
    }

    public async gluonProjectList(promptToCreateIfNoProjects: boolean = true): Promise<any[]> {

        logger.debug(`Trying to get all gluon projects.`);

        const result = await this.axiosInstance.get(`${QMConfig.subatomic.gluon.baseUrl}/projects`);

        if (!isSuccessCode(result.status)) {
            throw new QMError(`Failed to get projects.`);
        }

        let returnValue = [];

        if (!_.isEmpty(result.data._embedded)) {
            returnValue = result.data._embedded.projectResources;
        } else if (promptToCreateIfNoProjects) {
            const slackMessage: SlackMessage = {
                text: "Unfortunately there are no projects created yet.",
                attachments: [{
                    text: "Would you like to create a new project?",
                    fallback: "Would you like to create a new project?",
                    actions: [
                        buttonForCommand(
                            {
                                text: "Create project",
                            },
                            new CreateProject()),
                    ],
                }],
            };
            throw new QMError(`No projects exist yet`, slackMessage);
        }

        return returnValue;
    }

    public async createGluonProject(projectDetails: any): Promise<any> {
        logger.debug(`Trying to create gluon projects`);
        return await this.axiosInstance.post(`${QMConfig.subatomic.gluon.baseUrl}/projects`,
            projectDetails);

    }

    public async confirmBitbucketProjectCreated(projectId: string, bitbucketConfirmationDetails: any): Promise<any> {
        logger.debug(`Trying to confirm bitbucket project created. projectId: ${projectId}`);
        return await this.axiosInstance.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`,
            bitbucketConfirmationDetails);
    }

    public async requestProjectEnvironment(projectId: string, memberId: string): Promise<any> {
        logger.debug(`Trying to request project environments. projectId: ${projectId}; memberId: ${memberId}`);
        return await this.axiosInstance.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`,
            {
                projectEnvironment: {
                    requestedBy: memberId,
                },
            });
    }

    public async updateProjectPipelines(projectId: string, updateProjectPipelinesRequest: UpdateProjectPipelineRequest): Promise<any> {
        logger.debug(`Trying to request project environments. projectId: ${projectId}; memberId: ${updateProjectPipelinesRequest.createdBy}`);
        return await this.axiosInstance.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`,
            updateProjectPipelinesRequest);
    }

    public async associateTeamToProject(projectId: string, associationDetails: any): Promise<any> {
        logger.debug(`Trying to associate team to project. projectId: ${projectId}`);
        return await this.axiosInstance.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`, associationDetails);
    }

    public async updateProjectWithBitbucketDetails(projectId: string, bitbucketDetails: any): Promise<any> {
        logger.debug(`Trying to update project with bitbucket details. projectId: ${projectId}`);
        return await this.axiosInstance.put(`${QMConfig.subatomic.gluon.baseUrl}/projects/${projectId}`,
            bitbucketDetails);
    }
}

export interface UpdateProjectPipelineRequest {
    createdBy: string;
    devDeploymentPipeline: QMDeploymentPipeline;
    releaseDeploymentPipelines: QMDeploymentPipeline[];
}
