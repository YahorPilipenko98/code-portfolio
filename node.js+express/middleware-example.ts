import {Request, ParamsDictionary} from 'express-serve-static-core';
import {ResourceType} from '../model';
import {RoleSchema} from '../db-schema';
import {HttpError} from '../utils';
import HttpStatus from 'http-status-codes';
import {Response} from 'express';
import {BillingHandler} from './billing-handler';

interface ResultRolesMiddleware {
    (req: Request<ParamsDictionary>, res: Response, next: Function): Function;
}

export class RolesMiddleware {

    static checkRoles(resourceArray: ResourceType[]): ResultRolesMiddleware {
        return (req, res, next) => {
            if (req.user.admin) return next();
            if (req.user.roles.length) {
                const query = { _id: {$in: req.user.roles} };
                RoleSchema.find(query).then(roles => {
                    const resources = [];
                    roles.forEach(role => {
                        const roleParsed = role.toJSON();
                        resources.push(...roleParsed.resources);
                    });
                    if (resourceArray.every(item => resources.includes(item))) {
                        return next();
                    } else {
                        return next(new HttpError(HttpStatus.FORBIDDEN));
                    }
                }).catch(err => next(new HttpError(500, err)));
            }
        };
    }
}
