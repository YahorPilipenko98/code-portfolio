import { Inject, Injectable } from '@angular/core';
import { ContentStrategyModel } from './content-strategy.model';
import { APP_CONFIG } from '../config';
import { AppConfig } from '../../@types';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { PageableResponse } from '../../@core/data/object-response';

const CACHE_REGION = 'content-strategy';

@Injectable({
    providedIn: 'root'
})
export class ContentStrategyService {
    private readonly headers = new HttpHeaders({
        'cache-key': CACHE_REGION,
        'content-type': 'application/json'
    });

    public readonly ERROR_STRATEGY_ALREADY_EXISTS = 'content.strategy.already.exists';

    constructor(private http: HttpClient, @Inject(APP_CONFIG) private config: AppConfig) {}

    public create(strategyName: string, partnerId: string) {
        const url = `${this.config.contentsapiUrl}/api/content-strategy`;

        return this.http
            .post<any>(url, ContentStrategyModel.toJson(strategyName, partnerId), { headers: this.headers })
            .pipe(
                map((strategyId) => {
                    return strategyId;
                })
            );
    }

    public getAllContentStrategies(partnerId: string) {
        const url = `${this.config.apiUrl}/api/content-strategy/${partnerId}?limit=10000&offset=0`;

        return this.http.get<any>(url).pipe(
            map((response) => {
                return (response.data || []).map(ContentStrategyModel.fromJson);
            })
        );
    }

    public findContentStrategies(partnerId: string, offset: number = 0, limit: number = 10): Observable<PageableResponse<ContentStrategyModel>> {

        const url = `${this.config.apiUrl}/api/content-strategy/${partnerId}?limit=${limit}&offset=${offset}`;

        return this.http.get<<PageableResponse<ContentStrategyModel>>>(url).pipe(
            map((response) => {
                const strategies = (response.data || []).map(ContentStrategyModel.fromJson);
                return {
                    offset: response.offset,
                    limit: response.limit,
                    records: strategies,
                    total: response.total
                }
            })
        );
    }

}
