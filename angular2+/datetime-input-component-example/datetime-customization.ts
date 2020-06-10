import { Injectable } from '@angular/core';
import { NgbDatepickerI18n, NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';
import { TranslateService } from '@ngx-translate/core';

const CUSTOM_CALENDAR_LABELS = {
    weekdays: [
        'datepicker.weekdays.monday',
        'datepicker.weekdays.tuesday',
        'datepicker.weekdays.wednesday',
        'datepicker.weekdays.thursday',
        'datepicker.weekdays.friday',
        'datepicker.weekdays.saturday',
        'datepicker.weekdays.sunday'
    ],
    months: [
        'datepicker.months.january',
        'datepicker.months.february',
        'datepicker.months.march',
        'datepicker.months.april',
        'datepicker.months.may',
        'datepicker.months.june',
        'datepicker.months.july',
        'datepicker.months.august',
        'datepicker.months.september',
        'datepicker.months.october',
        'datepicker.months.november',
        'datepicker.months.december'
    ]
};

@Injectable()
export class CustomDatepickerI18n extends NgbDatepickerI18n {
    constructor(private translate: TranslateService) {
        super();
    }

    getWeekdayShortName(weekday: number): string {
        return this.translate.instant(CUSTOM_CALENDAR_LABELS.weekdays[weekday - 1]);
    }

    getMonthShortName(month: number): string {
        return this.translate.instant(CUSTOM_CALENDAR_LABELS.months[month - 1]);
    }

    getMonthFullName(month: number): string {
        return this.getMonthShortName(month);
    }

    getDayAriaLabel(date: NgbDateStruct): string {
        return `${date.month}-${date.day}-${date.year}`;
    }
}
