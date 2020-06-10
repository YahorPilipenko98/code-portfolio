'use strict';

import { Cache } from 'utils';
import objectHash from 'object-hash';

export default class UnsavedChangesWarnService {
    constructor() {
        UnsavedChangesWarnService.$inject.forEach((name, index) => {
            this[name] = arguments[index];
        });
        this._init();
    }

    _init() {
        this.watched = {};
        this.$transitions.onStart({}, (transition) => {
            let toState = transition.$to();
            let toParams = transition.params('to');
            if (_.isEmpty(this.watched)) {
                return;
            }
            var changedItemKey = _.find(_.keys(this.watched), key => {
                return this._checkEquality(key);
            });
            if (changedItemKey) {
                this.ModalWindowService.confirm({
                    title: `${changedItemKey} data not saved.`,
                    prompt: 'Leave page anyway?',
                    confirmCb: () => {
                        this.watched = {};
                        Cache.reset(); //Clean all cache because form data may be inconsistent
                        this.$state.go(toState.name, toParams);
                    }
                });
                return false;
            } else {
                this.watched = {};
            }
        });
    }

    _checkEquality(key) {
        return this._hash(this.watched[key].getCurrentState()) !== this.watched[key].hash;
    }

    _hash(object) {
        var clone = _.cloneDeep(object);
        var cleaned = this._cleanModel(clone);
        return objectHash(cleaned, {
            respectType: false,
            respectFunctionProperties: false,
            replacer: value => undefined === value ? null : value
        });
    }

    _cleanModel(object) {
        if (!_.isObject(object) && !_.isArray(object)) {
            return object;
        }
        _.forEach(object, (val, prop) => {
            if ('$$hashKey' === prop) {
                delete object.$$hashKey;
            } else if (val instanceof File) {
                object[prop] = val.size;
            } else {
                object[prop] = this._cleanModel(val);
            }
        });
        return object;
    }

    watch(key, getCurrentState) {
        this.watched[key] = {
            getCurrentState,
            hash: this._hash(getCurrentState())
        };
    }

    refresh(key) {
        this.watched[key].hash = this._hash(this.watched[key].getCurrentState());
    }

    stopWatching(key) {
        delete this.watched[key];
    }
}

UnsavedChangesWarnService.$inject = ['$transitions', '$state', '$window', 'ModalWindowService'];
