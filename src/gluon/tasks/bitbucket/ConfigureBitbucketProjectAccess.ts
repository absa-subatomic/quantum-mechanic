import {QMContext} from "../../../context/QMContext";
import {BitbucketConfigurationService} from "../../services/bitbucket/BitbucketConfigurationService";
import {BitbucketService} from "../../services/bitbucket/BitbucketService";
import {userFromDomainUser} from "../../util/member/Members";
import {QMProjectBase} from "../../util/transform/types/gluon/Project";
import {QMTeam} from "../../util/transform/types/gluon/Team";
import {Task} from "../Task";
import {TaskListMessage} from "../TaskListMessage";

export class ConfigureBitbucketProjectAccess extends Task {

    private readonly TASK_HEADER = TaskListMessage.createUniqueTaskName("ConfigureProjectBitbucket");
    private readonly TASK_ADD_SSH_KEYS = TaskListMessage.createUniqueTaskName("AddSSHKeys");
    private readonly TASK_ADD_BITBUCKET_USERS = TaskListMessage.createUniqueTaskName("AddBitbucketUsers");

    constructor(private team: QMTeam,
                private project: QMProjectBase,
                private bitbucketService: BitbucketService) {
        super();
    }

    protected configureTaskListMessage(taskListMessage: TaskListMessage) {
        this.taskListMessage.addTask(this.TASK_HEADER, `*Configure access to project ${this.project.name} in Bitbucket for Team ${this.team.name}*`);
        this.taskListMessage.addTask(this.TASK_ADD_SSH_KEYS, "\tAdd SSH Keys to Bitbucket Project");
        this.taskListMessage.addTask(this.TASK_ADD_BITBUCKET_USERS, "\tAdd user permissions to Bitbucket Project");
    }

    protected async executeTask(ctx: QMContext): Promise<boolean> {

        const bitbucketProjectKey = this.project.bitbucketProject.key;

        await this.bitbucketService.addBitbucketProjectAccessKeys(bitbucketProjectKey);

        const bitbucketConfigurationService = new BitbucketConfigurationService(this.bitbucketService);

        await this.taskListMessage.succeedTask(this.TASK_ADD_SSH_KEYS);

        await bitbucketConfigurationService.addAllOwnersToProject(bitbucketProjectKey, this.team.owners.map(owner => userFromDomainUser(owner.domainUsername)));
        await bitbucketConfigurationService.addAllMembersToProject(bitbucketProjectKey, this.team.members.map(member => userFromDomainUser(member.domainUsername)));

        await this.taskListMessage.succeedTask(this.TASK_ADD_BITBUCKET_USERS);

        await this.taskListMessage.succeedTask(this.TASK_HEADER);

        return true;
    }

}
