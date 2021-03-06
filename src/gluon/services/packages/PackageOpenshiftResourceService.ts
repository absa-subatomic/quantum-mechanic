import {
    OpenshiftListResource,
    OpenshiftResource,
} from "@absa-subatomic/openshift-api/build/src/resources/OpenshiftResource";
import {logger} from "@atomist/automation-client";
import _ = require("lodash");
import {QMError} from "../../util/shared/Error";
import {GenericOpenshiftResourceService} from "../projects/GenericOpenshiftResourceService";

export class PackageOpenshiftResourceService {

    constructor(private genericOpenshiftResourceService: GenericOpenshiftResourceService = new GenericOpenshiftResourceService()) {
    }

    public async getAllApplicationRelatedResources(applicationName, resources: OpenshiftListResource) {

        const applicationDC = this.findApplicationDeploymentConfig(applicationName, resources);

        const pvcs = this.findPVCs(applicationDC, resources);

        // oc export all does not export secrets and config maps. Need to change this if we want these
        // const secrets = this.findSecrets(applicationDC, resources);
        // const configMaps = this.findConfigMaps(applicationDC, resources);

        const imageStreams = this.findImageStreams(applicationDC, resources);

        const services = this.findServices(applicationDC, resources);

        const routes = this.findRoutes(resources, services);

        const collectedResources: OpenshiftResource[] = [];

        collectedResources.push(applicationDC);
        collectedResources.push(...pvcs);
        // resources.items.push(...secrets);
        // resources.items.push(...configMaps);
        collectedResources.push(...imageStreams);
        collectedResources.push(...services);
        collectedResources.push(...routes);

        resources.items = [];

        logger.info("Cleaning identified resources");
        resources.items.push(...this.genericOpenshiftResourceService.cleanAllPromotableResources(collectedResources));

        return resources;
    }

    private findApplicationDeploymentConfig(applicationName: string, openshiftResources: OpenshiftListResource) {
        const kebabbedName = _.kebabCase(applicationName);

        for (const resource of openshiftResources.items) {
            if (resource.kind === "DeploymentConfig" && resource.metadata.name === kebabbedName) {
                resource.spec.replicas = 0;
                return resource;
            }
        }

        throw new QMError("Failed to find DeploymentConfig for selected application.");
    }

    private findPVCs(applicationDC, allResources: OpenshiftListResource) {
        const pvcs = [];
        try {
            const pvcNames = this.getPvcNames(applicationDC);
            for (const pvcName of pvcNames) {
                const pvc = this.findResourceByKindAndName(allResources, "PersistentVolumeClaim", pvcName);
                if (pvc !== null) {
                    delete pvc.spec.volumeName;
                    delete pvc.metadata.annotations;
                    pvcs.push(pvc);
                }
            }
            logger.info("Found PVC's for application");
        } catch (error) {
            logger.info("No PVC's found for application");
            // logger.debug(error);
        }
        return pvcs;
    }

    private findSecrets(applicationDC, allResources: OpenshiftListResource) {
        const secrets = [];
        try {
            const secretNames = this.getSecretNames(applicationDC);
            for (const secretName of secretNames) {
                const secret = this.findResourceByKindAndName(allResources, "Secret", secretName);
                if (secret !== null) {
                    secrets.push(secret);
                }
            }
            logger.info("Found Secrets's for application");
        } catch (error) {
            logger.info("No Secrets found for application");
            // logger.debug(error);
        }
        return secrets;
    }

    private findConfigMaps(applicationDC, allResources: OpenshiftListResource) {
        const configMaps = [];
        try {
            const configMapNames = this.getConfigMapNames(applicationDC);
            for (const configMapName of configMapNames) {
                const configMap = this.findResourceByKindAndName(allResources, "ConfigMap", configMapName);
                if (configMap !== null) {
                    configMaps.push(configMap);
                }
            }
            logger.info("Found ConfigMaps's for application");
        } catch (error) {
            logger.info("No ConfigMaps found for application");
            // logger.debug(error);
        }
        return configMaps;
    }

    private findResourceByKindAndName(allResources: OpenshiftListResource, kind: string, name: string) {
        logger.info("Trying to find: " + name);

        for (const resource of allResources.items) {
            logger.info("Kind: " + resource.kind);
            logger.info("Name: " + resource.metadata.name);
            if (resource.kind === kind && resource.metadata.name === name) {
                return resource;
            }
        }
        return null;
    }

    private getPvcNames(applicationDC) {
        const pvcNames = [];
        for (const volume of applicationDC.spec.template.spec.volumes) {
            if (!volume.persistentVolumeClaim === undefined) {
                pvcNames.push(volume.persistentVolumeClaim.claimName);
            }
        }
        return pvcNames;
    }

    private getSecretNames(applicationDC) {
        const secretNames = [];
        for (const volume of applicationDC.spec.template.spec.volumes) {
            if (!volume.secret === undefined) {
                secretNames.push(volume.secret.secretName);
            }
        }
        return secretNames;
    }

    private getConfigMapNames(applicationDC) {
        const secretNames = [];
        for (const volume of applicationDC.spec.template.spec.volumes) {
            if (!volume.configMap === undefined) {
                secretNames.push(volume.configMap.name);
            }
        }
        return secretNames;
    }

    private findImageStreams(applicationDC, allResources: OpenshiftListResource) {
        const imageStreams = [];
        try {
            const imageNameParts = applicationDC.spec.template.spec.containers[0].image.split("/");
            const imageStreamName = imageNameParts[imageNameParts.length - 1].split(":")[0].split("@")[0];
            const imageStream = this.findResourceByKindAndName(allResources, "ImageStream", imageStreamName);
            if (imageStream !== null) {
                imageStream.spec.tags = [];
                imageStreams.push(imageStream);
            }
            logger.info("Found imagestream's for application");
        } catch (error) {
            logger.info("Unable to find image stream for DC");
            // logger.debug(error);
        }
        return imageStreams;
    }

    private findServices(applicationDc, allResources: OpenshiftListResource) {
        const services = [];
        try {
            for (const resource of allResources.items) {
                if (resource.kind === "Service") {
                    try {
                        if (resource.spec.selector.name === applicationDc.metadata.name) {

                            services.push(resource);
                        }
                    } catch (error) {
                        // do nothing
                    }
                }
            }
            logger.info("Found services's for application");
        } catch (error) {
            logger.info("Unable to find services for DC");
            // logger.debug(error);
        }
        return services;
    }

    private findRoutes(allResources: OpenshiftListResource, services) {
        const routes = [];
        try {
            for (const resource of allResources.items) {
                if (resource.kind === "Route") {
                    for (const service of services) {
                        if (resource.spec.to.name === service.metadata.name) {
                            delete resource.spec.host;
                            resource.status = {};
                            routes.push(resource);
                            break;
                        }
                    }
                }
            }
            logger.info("Found Routes's for application");
        } catch (error) {
            logger.info("Unable to find routes for DC");
            // logger.debug(error);
        }
        return routes;
    }
}
