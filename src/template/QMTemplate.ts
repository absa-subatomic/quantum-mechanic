import {logger} from "@atomist/automation-client";
import * as Handlebars from "handlebars";

export class QMTemplate {

    private readonly template: HandlebarsTemplateDelegate;

    constructor(templateFile: string, trimLines = false) {
        const fs = require("fs");
        const buffer = fs.readFileSync(templateFile);
        this.template = Handlebars.compile(buffer.toString());
    }

    public build(parameters: { [k: string]: any }) {
        logger.info("Hello");
        const safeParameters: { [k: string]: any } = Object.assign([], parameters);
        logger.info("Hello2");
        this.toSafeStrings(safeParameters);
        logger.info("Hello3");
        return this.template(safeParameters);
    }

    public toSafeStrings(obj: any) {
        for (const property in obj) {
            if (obj.hasOwnProperty(property)) {
                if (typeof obj[property] === "object") {
                    return this.toSafeStrings(obj[property]);
                } else {
                    obj[property] = new Handlebars.SafeString(obj[property]);
                }
            }
        }
    }
}
