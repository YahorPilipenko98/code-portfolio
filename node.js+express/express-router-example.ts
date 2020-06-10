import {Router} from './router';
import {Express} from 'express';
import passport from 'passport';
import Promise from 'bluebird';
import HttpStatus from 'http-status-codes';
import {AuthorizationType, ResourceType} from '../model';
import {AccessControlUtils, RolesMiddleware} from '../services';
import {UserStorySchema} from '../db-schema';
import {UserStoryModel} from '../model/user-story';
import {DatesRange, ComplaintsRouter} from './complaints';

export class LastPositionsUsers extends Router {
    static register(app: Express) {
        app.get('/users/positions/:id', passport.authenticate(AuthorizationType.Custom, {session: false}),
            RolesMiddleware.checkRoles([ResourceType.Admin]), (req, res) => {
                UserStorySchema.find({
                    owner: req.params.id,
                    locationDate: {$gte: req.query.startDate, $lte: req.query.endDate}
                }).sort({'locationDate': 1}).exec().map(UserStoryModel.fromDb).then((userStory) => {
                    const location = userStory.map((document) => {
                        return {
                            lat: document.lastLocation.lat,
                            lng: document.lastLocation.lng,
                            date: document.locationDate
                        };
                    });
                    res.send(location);
                });
            });

        app.get('/users/positions', passport.authenticate(AuthorizationType.Custom, {session: false}),
            RolesMiddleware.checkRoles([ResourceType.Admin]), (req, res, next) => {
                let limit = req.query.limit ? +req.query.limit : 10;
                let offset = req.query.offset ? +req.query.offset : 0;
                let query = AccessControlUtils.getOwnershipQuery(req, true);
                if (['userIds', 'userEmails', 'periodTime', 'periodDate'].some(
                    element => Object.keys(req.query).includes(element))) {
                    query = {$and: [AccessControlUtils.getOwnershipQuery(req, true)]};
                    let range: DatesRange;
                    for (let key in req.query) {
                        switch (key) {
                            case 'userIds':
                                const uIds = JSON.parse(req.query[key]);
                                query['$and'].push({owner: {$in: uIds}});
                                break;
                            case 'userEmails':
                                query['$and'].push({email: {$in: JSON.parse(req.query[key])}});
                                break;
                            case 'periodDate':
                                range = JSON.parse(req.query[key]);
                                if (range.start) {
                                    range.start = new Date(range.start);
                                }
                                if (range.end) {
                                    range.end = new Date(range.end);
                                    range.end.setHours(23);
                                    range.end.setMinutes(59);
                                    range.end.setSeconds(59);
                                }
                                query.locationDate = {$gte: range.start, $lte: range.end};
                                break;
                            case 'periodTime':
                                const timeRange = JSON.parse(req.query[key]);
                                if (query.locationDate) delete query.locationDate;
                                query.$or = ComplaintsRouter.filterForTimeRange(timeRange, range, 'locationDate');
                                break;
                            default:
                                break;
                        }
                    }
                }
                Promise.props({
                    users: UserStorySchema.find(query).skip(offset).limit(limit).exec().map(UserStoryModel.fromDb),
                    total: UserStorySchema.countDocuments(query)
                }).then(({users, total}) => {
                    res.status(HttpStatus.OK).send({
                        limit,
                        offset,
                        total,
                        records: users
                    });
                }).catch(next);
            });

    }
}
