const {AccessControlUtils} = require('./access-control-utils');
const {CameraSchema, ParkingSchema} = require('../db-schema');
const {CameraModel, CameraType, AuthorizationType, ParkingModel} = require('../model');
const {Detector} = require('./detector');
const ftp_updateImg = require('./ftp-update-img');
const Promise = require('bluebird');
Promise.config({cancellation: true});
const HttpError = require('../utils/http-error');
const CoordinatesCalc = require('../utils/coordinatesCalc');
const HttpStatus = require('http-status-codes');
const Log = require('./logger');
const DispatcherTask = require('./dispatcher-task');
const Flussonic = require('./flussonic');
const Errai = require('./errai');
const config = require('../config');

const EmailService = require('./email');
const mongoose = require('mongoose');
const POLL_INTERVAL = 1000 * 30;//30 sec
const SNAPSHOT_TIMEOUT = 1000 * 30;//30 sec
const PREDICTION_TIMEOUT = 1000 * 20;//20 sec
const TASK_RUNNER_TIMEOUT = 200;//ms
const STATE_CHECKER_TIMEOUT = 1000 * 60;//1 min
const QUEUE_TIMEOUT = 1000 * 60 * 5;//5 min
const PENALTY_TIMEOUT = 1000 * 60 * 20;//20min
const FTP_UPDATE_INTERVAL = 1000 * 60 * 2.5; //2.5 min update ftp image
const PREDICT_CONCURRENCY = 10;
const FAILED_SNAPSHOT_COUNT = 5;
const DIFFERENCE_BBOX_COUNT = 3;
const TIME_START_DIFFERENCE_BBOX_COUNT = 1000 * 60 * 2.5;
let responseMap = {};
let mapJson = {};
const STATE_PENALTY_COUNT_TO_ERROR = 5;
let current_STATE_PENALTY = 0;

class CameraResponse {
    constructor(data = [], failedSnapshotCount = 0) {
        this.data = data;
        this.failedSnapshotCount = failedSnapshotCount;
    }
}

class SpotsJson {
    constructor(map = [], vacantSpots = 0, allSpots = 0, timeStartCheckDifference = 0) {
        this.map = map;
        this.vacantSpots = vacantSpots;
        this.allSpots = allSpots;
        this.timeStartCheckDifference = timeStartCheckDifference;
    }

    set(boxes, time) {
        this.map = boxes.map;
        this.vacantSpots = boxes.vacantSpots;
        this.allSpots = boxes.allSpots;
        this.timeStartCheckDifference = time;
    }
}

module.exports = class Dispatcher {
    constructor() {
        this.tasks = [];
    }

    run() {
        new Flussonic().run();
        new Errai().run();
        setInterval(() => {
            let result = this.tasks.reduce((m, task) => {
                if (!m[task.state]) {
                    m[task.state] = 0;
                }
                m[task.state] = m[task.state] + 1;
                return m;
            }, {});
            let diffPenaltyCount = result.STATE_PENALTY - current_STATE_PENALTY;
            if (Math.abs(diffPenaltyCount) >= STATE_PENALTY_COUNT_TO_ERROR) {
                let penalty = [];
                this.tasks.forEach(task => {
                    if (task.state === DispatcherTask.STATE_PENALTY) {
                        penalty.push(task.camera.id);
                    }
                });
                if (penalty.length) {
                    Dispatcher.sendEmail(penalty, diffPenaltyCount);
                }
            }
            current_STATE_PENALTY = result.STATE_PENALTY ? result.STATE_PENALTY : 0;
            Log.info(`[dispatcher.run] Tasks state ${JSON.stringify(result)}`);
        }, STATE_CHECKER_TIMEOUT);

        setInterval(() => {
            try {
                this.addTasks();
            } catch (e) {
                Log.error(`[dispatcher.run] setInterval AddTask Error[${e}]`);
            }
        }, POLL_INTERVAL);
        setInterval(() => {
            try {
                this.processTasks();
            } catch (e) {
                Log.debug(`[dispatcher.run]setInterval processTasks Tasks[${this.tasks}]`);
                Log.error(`[dispatcher.run]setInterval processTasks Error[${e}, ${e.stack}]`);
            }
        }, TASK_RUNNER_TIMEOUT);

        setInterval(() => {
            try {
                return CameraSchema.find({active: true, cameraType: 'ftp'}).exec().map(item => {
                    return {
                        'ftpParams': item.ftpParams
                    };
                }).then(camera => {
                    if (camera[0]) {
                        ftp_updateImg.run(camera[0].ftpParams);
                    }
                });
            } catch (e) {
                Log.error(`[dispatcher.run]setInterval ftpUpdate Error[${e}]`);
            }

        }, FTP_UPDATE_INTERVAL);
    }

    async addTasks() {
        let cameras = await Dispatcher.getActiveCameras();
        cameras.forEach(camera => {
            let hasTask = this.tasks.some(t => t.camera.id === camera.id);
            if (hasTask) {
                return;
            }
            this.tasks.push(new DispatcherTask(camera, {
                timestamp: Date.now(),
                state: DispatcherTask.STATE_JUST_ADDED
            }));
        });
    }

    processTasks() {
        this.tasks.filter(t => {
            if (t.hasState(DispatcherTask.STATE_URL_BUILDING) && t.isOverdue(SNAPSHOT_TIMEOUT)) {
                return true;
            } else if (t.hasState(DispatcherTask.STATE_PREDICTING) && t.isOverdue(PREDICTION_TIMEOUT)) {
                responseMap[t.camera.id].failedSnapshotCount += 1;
                if (responseMap[t.camera.id].failedSnapshotCount >= FAILED_SNAPSHOT_COUNT) {
                    t.state = DispatcherTask.STATE_PENALTY;
                    if (!this.tasks.some(t => t.camera.id === t.camera.id)) {//in case if other thread has removed this task from list
                        this.tasks.push(t);
                    }
                }
                return true;
            } else if (t.hasState(DispatcherTask.STATE_PENALTY) && t.isOverdue(PENALTY_TIMEOUT)) {
                responseMap[t.camera.id].failedSnapshotCount = 0;
                return true;
            } else if (t.isOverdue(QUEUE_TIMEOUT) && !t.hasState(DispatcherTask.STATE_PENALTY)) {
                Log.error(`[dispatcher.processTasks] Task[${t}] was canceled because of overdue by [${QUEUE_TIMEOUT}]`);
                return true;
            }
        }).forEach((task) => {
            let timeout = ((Date.now() - task.timestamp) / 1000) | 0;
            Log.warn(`[dispatcher.processTasks] Task[${task}] cancelled by timeout[${timeout}s]; failedSnapshotCount=${responseMap[task.camera.id].failedSnapshotCount}`);
            task.state = DispatcherTask.STATE_FAILED;
            if (task.cancellable) {
                task.cancellable.cancel();
            }
        });

        this.findTasksByState(DispatcherTask.STATE_JUST_ADDED).some(task => {
            task.state = DispatcherTask.STATE_URL_BUILDING;
            task.timestamp = Date.now();
            this.buildImageUrl(task);
        });

        this.findTasksByState(DispatcherTask.STATE_HAS_URL).map(task => {
            if (PREDICT_CONCURRENCY <= this.findTasksByState(DispatcherTask.STATE_PREDICTING).length) {
                return true;
            }
            task.state = DispatcherTask.STATE_PREDICTING;
            task.timestamp = Date.now();
            this.detect(task);
        });

        this.findTasksByState(DispatcherTask.STATE_HAS_PREDICTION).forEach(task => {
            task.state = DispatcherTask.STATE_DONE;
            let camera = task.camera;
            if (responseMap[camera.id]) {
                responseMap[camera.id].data = task.data.detections;
            } else {
                responseMap[camera.id] = new CameraResponse(task.data);
            }
            Log.debug(`[dispatcher.processTasks] find cars from ${camera.id}`);
        });
        this.tasks = this.tasks.filter(t => {
            return [DispatcherTask.STATE_DONE, DispatcherTask.STATE_FAILED].indexOf(t.state) === -1;
        });
    }

    findTasksByState(state) {
        return this.tasks.filter(t => t.hasState(state));
    }

    static async getActiveCameras() {
        let cameras = await CameraSchema.find({active: true}).cache(60);
        return cameras.map((item) => {
            return CameraModel.fromDb(item);
        });
    }

    static getAllCameras(req) {
        const query = (req.query.cameras) ? {cameras: {$in: req.query.cameras.split(',')}} : AccessControlUtils.getOwnershipQuery(req, true);
        return ParkingSchema.find(query).then(parkings => {
            const cameraIds = [];
            parkings.forEach(parking => {
                cameraIds.push(...parking.cameras);
            });
            if (!cameraIds.length) {
                return null;
            }
            return {
                $or: cameraIds.map(camera => {
                    return {_id: camera};
                })
            };
        }).then(query => {

            if (!query) return [];

            if (['id', 'active', 'cameraType'].some(element => Object.keys(req.query).includes(element))) {
                query = {$and: [query]};
                for (let key in req.query) {
                    switch (key) {
                        case 'id':
                            if (req.query[key].indexOf(',') > -1) {
                                let request = {$or: []};
                                const arr = req.query[key].split(',');
                                arr.forEach(item => {
                                    request['$or'].push({_id: mongoose.Types.ObjectId(item)});
                                });
                                query['$and'].push(request);
                            } else {
                                const cameraId = mongoose.Types.ObjectId(req.query[key]);
                                query['$and'].push({_id: cameraId});
                            }
                            break;
                        case 'active':
                            query['$and'].push({active: req.query[key] === 'true' || 'false'});
                            break;
                        case 'cameraType':
                            query['$and'].push({cameraType: {$regex: req.query[key]}});
                            break;
                        default:
                            break;
                    }
                }
            }

            return CameraSchema.find(query).exec().map(item => {
                let failed = false;
                if (responseMap[item.id]) {
                    failed = responseMap[item.id].failedSnapshotCount > FAILED_SNAPSHOT_COUNT;
                }
                return CameraModel.fromDb(item, failed);
            });
        });
    }

    buildImageUrl(task) {
        let camera = task.camera;
        if (!responseMap[camera.id]) {
            responseMap[camera.id] = new CameraResponse();
        }
        task.data = Dispatcher.getImageUrl(camera);
        task.state = DispatcherTask.STATE_HAS_URL;
        return task;
    }

    static getImageUrl(camera) {
        Log.debug(`[dispatcher.getImageUrl] get image params from camera[${camera.id}]`);
        let headers = {};
        if (camera.auth) {
            if (camera.auth.authType === AuthorizationType.Basic) {
                let buff = new Buffer(camera.auth.login + ':' + camera.auth.password);
                headers = {
                    'Authorization': 'Basic ' + buff.toString('base64')
                };
            }
        }
        try {
            switch (camera.cameraType) {
                case CameraType.RTSP: {
                    let ffmpegParams = Dispatcher.makeFfmpegParams(camera);
                    return {ffmpegParams, type: CameraType.RTSP, headers};
                }
                case CameraType.ERRAI: {
                    camera.data = Errai.getErraiUrl(camera.data);
                    let ffmpegParams = Dispatcher.makeFfmpegParams(camera);
                    return {ffmpegParams, type: CameraType.RTSP, headers};
                }
                case CameraType.IMG:
                case CameraType.FTP: {
                    return {url: camera.data, type: CameraType.IMG, headers};
                }
                case CameraType.FLUSSONIC: {
                    return {url: Flussonic.getToken(camera.data), type: CameraType.IMG, headers};
                }
                default:
                    return Promise.reject(new Error(`Not supported camera type[${camera.cameraType}]`));
            }
        } catch (e) {
            return Promise.reject(e);
        }
    }

    static makeFfmpegParams(camera) {
        let ffmpegParams = [
            '-rtsp_transport', 'tcp',
            '-i', camera.data,
            '-y', '-f', 'image2',
            '-ss', '00:00:01.50', '-vframes', '1',
            '-loglevel', 'fatal',
            'pipe:1' // Output on stdout
        ];
        if (camera.cameraType === CameraType.ERRAI) {
            ffmpegParams.splice(0, 2);
        }
        return ffmpegParams;
    }


    detect(task) {
        let hint = task.camera.id;
        Log.debug(`[dispatcher.detect] Start for camera[${hint}]`);
        task.cancellable = Detector.detect(task.data, {hint, viewType: task.camera.viewType})
            .then(body => {
                task.data = body;
                task.state = DispatcherTask.STATE_HAS_PREDICTION;
                responseMap[task.camera.id].failedSnapshotCount = 0;
                return task;
            }).catch(err => {
                Log.warn(`[dispatcher.detect] Error[${err}] by camera[${hint}]`);
                task.state = DispatcherTask.STATE_DETECT_FAILED;
            }).finally(() => {
                if (task.hasState(DispatcherTask.STATE_DETECT_FAILED)) {
                    responseMap[task.camera.id].failedSnapshotCount += 1;
                }
                if (responseMap[task.camera.id].failedSnapshotCount >= FAILED_SNAPSHOT_COUNT) {
                    task.state = DispatcherTask.STATE_PENALTY;
                    if (!this.tasks.some(t => t.camera.id === task.camera.id)) {//in case if other thread has removed this task from list
                        this.tasks.push(task);
                    }
                }
            });
        return task.cancellable;
    }

    static findSpotsByCameras(cameras = []) {
        return CoordinatesCalc.getSpotSettings().then((settings) => {
            return cameras.reduce((m, camera) => {
                m[camera.id] = Dispatcher.calculateSpotsForCamera(CameraModel.fromDb(camera), settings);
                return m;
            }, {});
        }).catch(err => {
            if (err.code) {
                return err;
            } else {
                return (new HttpError(HttpStatus.INTERNAL_SERVER_ERROR, err));
            }
        });
    }

    static calculateSpotsForCamera(camera, settings) {
        let coordinates = [];
        let failed = false;
        if (!responseMap[camera.id]) {
            responseMap[camera.id] = new CameraResponse();
        }
        if (responseMap[camera.id].failedSnapshotCount < FAILED_SNAPSHOT_COUNT) {
            coordinates = responseMap[camera.id].data.map(pos => {
                return [
                    pos.bbox[0],
                    1 - pos.bbox[1],
                    pos.bbox[2],
                    pos.bbox[3]
                ];
            });
        } else {
            failed = true;
        }
        if (!mapJson[camera.id]) {
            mapJson[camera.id] = new SpotsJson();
        }
        let timeNow = Date.now();
        let boxes = CoordinatesCalc.calculateExactFreeSpots(camera, settings, coordinates, failed);
        if (mapJson[camera.id].map.length === 0) {
            mapJson[camera.id].set(boxes, 0);
            return mapJson[camera.id];
        }
        if (mapJson[camera.id].timeStartCheckDifference === 0) {
            if (Math.abs(mapJson[camera.id].vacantSpots - boxes.vacantSpots) > DIFFERENCE_BBOX_COUNT) {
                mapJson[camera.id].timeStartCheckDifference = timeNow;
                return mapJson[camera.id];
            }
        }
        if (Math.abs(timeNow - mapJson[camera.id].timeStartCheckDifference) < TIME_START_DIFFERENCE_BBOX_COUNT) {
            return mapJson[camera.id];
        }
        mapJson[camera.id].set(boxes, 0);
        return mapJson[camera.id];
    }

    static getJsonById(id) {
        return CameraSchema.findOne({active: true, _id: id}).cache(config.dev ? 5 : 60).then(camera => {
            return Dispatcher.findSpotsByCameras([camera]);
        });

    }

    static setResponseMap(id, resp) {
        if (!responseMap[id]) {
            responseMap[id] = new CameraResponse();
        }
        responseMap[id].data = resp;
    }

    static async getParkingIDByCamera(cameras) {
        let parkings = await ParkingSchema.find({}).exec().map(parking => {
            let parkingModel = ParkingModel.fromDb(parking);
            let cameras = parkingModel.cameras.map(camera => {
                return camera.toString();
            });
            return {
                id: parkingModel.id,
                cameras,
                address: `${parkingModel.country}, ${parkingModel.city}, ${parkingModel.address}`
            };
        });
        return cameras.map(camera => {
            let cameraModel = {};
            if (typeof (camera) === 'string') {
                cameraModel.id = camera;
            } else {
                cameraModel = CameraModel.fromDb(camera);
            }
            let parking = parkings.find(parking => {
                if (parking.cameras.includes(cameraModel.id)) {
                    return parking;
                }
            });
            parking ? cameraModel.parkingId = parking.id : cameraModel.parkingId = 'Undefined Parking';
            if (parking) {
                cameraModel.parkingId = parking.id;
                cameraModel.parkingAddress = parking.address;
            } else {
                cameraModel.parkingAddress = cameraModel.parkingId = 'Undefined Parking';
            }
            return cameraModel;
        });
    }

    static sendEmail(penalty, countDifferent) {
        Dispatcher.getParkingIDByCamera(penalty).then(parkings => {
            let penaltyParkings = {};
            parkings.forEach(cam => {
                if (!penaltyParkings[cam.parkingId]) {
                    penaltyParkings[cam.parkingId] = {};
                    penaltyParkings[cam.parkingId].cameras = [];
                    penaltyParkings[cam.parkingId].address = cam.parkingAddress;
                }
                penaltyParkings[cam.parkingId].cameras.push(cam.id);
            });
            let body = '';
            for (let parking in penaltyParkings) {
                if (penaltyParkings.hasOwnProperty(parking)) {
                    body += 'Address Parking: ' + penaltyParkings[parking].address + '<br>Parking ID = ' + parking + ' : ' + JSON.stringify(penaltyParkings[parking].cameras) + '<br><br>';
                }
            }
            const subject = `${config.dev ? 'Dev server' : 'Prod server'} STATE_PENALTY Error!`;
            let html = `${Math.abs(countDifferent)} ${(countDifferent > 0) ? 'cameras are now turned OFF' : 'cameras are now turned ON'}<br> Penalty cameras: <br><br>` + body;
            EmailService.send({
                to: config.feedback.adminMail,
                subject,
                html
            });
            EmailService.send({
                to: config.feedback.ceoMail,
                subject,
                html
            });
        });
    }
};
