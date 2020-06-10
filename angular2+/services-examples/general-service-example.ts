import { Inject, Injectable, NgZone } from '@angular/core';
import { StateService } from '@uirouter/angular';
import { Auth } from '../../core-api/auth';
import * as store from 'store';
import { defer, fromEvent, interval, merge } from 'rxjs';
import { WindowRefService } from './window.service';
import { ClaimsService } from '../../feature-claims';
import { APP_CONFIG } from '../../core-api/config';
import { AppConfig } from '../../@types';
import { delay, filter, retryWhen, switchMap, takeUntil, tap } from 'rxjs/operators';

const MINUTES_UNTIL_AUTO_LOGOUT = 20; // minutes
const CHECK_INTERVAL = 1000 * 10; //  milliseconds
const STORE_KEY = 'lastAction';
const DELAY_FOR_REPEAT_REQUEST = 1000 * 60; // milliseconds

@Injectable({
    providedIn: 'root'
})
export class AutoLogoutService {
    constructor(
        private router: StateService,
        private ngZone: NgZone,
        private windowRef: WindowRefService,
        private claimsService: ClaimsService,
        @Inject(APP_CONFIG) private config: AppConfig
    ) {}

    get lastAction() {
        return parseInt(store.get(STORE_KEY));
    }

    set lastAction(value) {
        store.set(STORE_KEY, value);
    }

    public init() {
        const checkPartner$ = defer(() => this.claimsService.getActualPartner()).pipe(
            retryWhen((errors) => errors.pipe(delay(DELAY_FOR_REPEAT_REQUEST))),
            filter((partner: any) => partner.partnerId === this.config.autoLogoutPartnerId)
        );

        const claim$ = this.claimsService.onActualPartnerChanged.pipe(switchMap(() => checkPartner$));

        return merge(claim$, checkPartner$).pipe(
            tap(() => {
                this.initListener();
                this.initInterval();
            })
        );
    }

    private initListener() {
        this.ngZone.runOutsideAngular(() => {
            const onClick = fromEvent(document.body, 'click');
            const onKeyDown = fromEvent(document.body, 'keydown');
            const onScroll = fromEvent(document.body, 'scroll');
            const onMouseDown = fromEvent(document.body, 'mousedown');

            merge(onClick, onKeyDown, onScroll, onMouseDown)
                .pipe(takeUntil(this.claimsService.onActualPartnerChanged))
                .subscribe(() => {
                    if ('requestIdleCallback' in window) {
                        this.windowRef.nativeWindow.requestIdleCallback(this.reset.bind(this), { timeout: 2000 });
                    } else {
                        this.reset();
                    }
                });
        });
    }

    private initInterval() {
        this.ngZone.runOutsideAngular(() => {
            interval(CHECK_INTERVAL)
                .pipe(takeUntil(this.claimsService.onActualPartnerChanged))
                .subscribe(() => {
                    if ('requestIdleCallback' in window) {
                        this.windowRef.nativeWindow.requestIdleCallback(this.check.bind(this), { timeout: 2000 });
                    } else {
                        this.reset();
                    }
                });
        });
    }

    private reset() {
        this.lastAction = Date.now();
    }

    private check() {
        const now = Date.now();
        const timeleft = this.lastAction + MINUTES_UNTIL_AUTO_LOGOUT * 60 * 1000;
        const diff = timeleft - now;
        const isTimeout = diff < 0;

        this.ngZone.run(() => {
            if (isTimeout && Auth.isLoggedIn()) {
                Auth.logout().then(() => {
                    this.router.go('home');
                });
            }
        });
    }
}
