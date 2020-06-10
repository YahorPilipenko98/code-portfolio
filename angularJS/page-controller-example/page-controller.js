'use strict';

import Config from 'core-api/config.js';
import MobileSimulationSession from 'core-api/mobile-simulator/mobile-simulation-session.js';
import WebSocketMessagePayload from 'core-api/web-socket-message-payload.js';

export default class PageController {
    constructor() {
        PageController.$inject.forEach((name, index) => {
            this[name] = arguments[index];
        });
        this.HUB_NAME = 'MobileSimNotificationHub';
        this.messages = [];
        this.sessionId = this.$state.params.sessionId;
        this.$scope.$on('$destroy', () => {
            this.$interval.cancel(this.intervalPromise);
        });
        this.init();
    }

    init() {
        if (!this.sessionId) {
            return this.$state.go('mobile-simulation.sessions');
        }

        this.loading = true;
        this._loadStatus().then(() => {
            if (this.status === MobileSimulationSession.STATUS_CREATED || this.status ===
                MobileSimulationSession
                .STATUS_STARTED) {
                return this.connect();
            }
        }).then(() => {
            return MobileSimulationSession.getLog({ sessionId: this.sessionId });
        }).then(logs => {
            this.$timeout(() => {
                _.remove(this.messages, existingMessage => _.some(logs.data,
                    logMessage => logMessage.datetime.getTime() ===
                    existingMessage.datetime.getTime() && logMessage.message ===
                    existingMessage.message));
                this.messages.unshift(...logs.data.reverse());
            });
        }).then(() => {
            this.$interval.cancel(this.intervalPromise);
            this.intervalPromise = this.$interval(() => {
                return this._loadStatus().then(() => {
                    if (this.status !== MobileSimulationSession.STATUS_STARTED) {
                        this.$interval.cancel(this.intervalPromise);
                    }
                });
            }, 2000);
        }).finally(() => {
            this.loading = false;
        });

        this.$scope.$on('$destroy', () => {
            this.disconnect();
        });
    }

    _loadStatus() {
        return this.getSessionData(this.sessionId).then(sessionData => {
            return this.status = sessionData.status;
        });
    }

    cancel() {
        this.cancelPromise = MobileSimulationSession.cancel(this.sessionId).then(() =>
            this._loadStatus());
    }

    isCancelable() {
        return this.status === MobileSimulationSession.STATUS_STARTED;
    }

    getSessionData(sessionId) {
        return MobileSimulationSession.find({ id: sessionId }).then(sessions => {
            return this.sessionData = sessions.data[0];
        });
    }

    connect() {
        this.disconnect();
        return this.SignalrConnectionService.establishConnection(
            `${Config.get('simulatorApiUrl')}/signalr-web-runner`,
            this.HUB_NAME, { 'SimulationId': this.sessionId }
        ).connecting.then(() => {
            this.logMessagesSubscriptionToken = this.SignalrConnectionService.subscribe(
                WebSocketMessagePayload.TYPE_SIMULATION_MESSAGE,
                (message) => {
                    this.onSimulationLogMessageReceived(message);
                }
            );
            this.simulationFinishSubscriptionToken = this.SignalrConnectionService.subscribe(
                WebSocketMessagePayload.TYPE_SIMULATION_FINISH,
                (message) => {
                    this.onSimulationFinishMessageReceived(message);
                }
            );
        });
    }

    onSimulationLogMessageReceived(message) {
        this.$timeout(() => {
            this.messages.push(message);
        });
    }

    onSimulationFinishMessageReceived() {
        this.disconnect();
    }

    disconnect() {
        if (!this.logMessagesSubscriptionToken) {
            return;
        }
        this.SignalrConnectionService.unsubscribe(this.logMessagesSubscriptionToken);
        this.SignalrConnectionService.unsubscribe(this.simulationFinishSubscriptionToken);
        this.SignalrConnectionService.disconnect();
    }

}
PageController.$inject = ['$scope', '$state', '$timeout', 'SignalrConnectionService', '$interval'];
