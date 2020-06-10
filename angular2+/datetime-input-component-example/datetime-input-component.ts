import { Component, forwardRef, Input } from '@angular/core';
import './datetime-input.scss';
import { AbstractControl, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import { AControlValueAccessor } from '../a-control-value-accessor';
import {
    NgbCalendar,
    NgbDate,
    NgbDateAdapter,
    NgbDatepickerI18n,
    NgbDateStruct,
    NgbInputDatepicker
} from '@ng-bootstrap/ng-bootstrap';
import { CustomDatepickerI18n } from 'ui-library/component-datetime-input/datetime-customization';
import { Time } from 'core-api/time';
import _padStart from 'lodash/padStart';
import { TIMEZONES } from 'ui-library/component-datetime-input/timezones';
import { DatetimeAdapter } from 'ui-library/component-datetime-input/datetime-adapter';

const enum Period {
    AM = 'AM',
    PM = 'PM'
}

const DEFAULT_TIMEZONE = 'UTC';
const RANGE_CLASS = 'range';
const RANGE_START_CLASS = 'start';
const RANGE_END_CLASS = 'end';

const PERIOD_TITLE_MAP = {
    [Period.AM]: 'datepicker.periods.am',
    [Period.PM]: 'datepicker.periods.pm'
};

@Component({
    selector: 'pz-datetime-input',
    templateUrl: './datetime-input.html',
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => DateTimeInputComponent),
            multi: true
        },
        {
            provide: NG_VALIDATORS,
            useExisting: forwardRef(() => DateTimeInputComponent),
            multi: true
        },
        { provide: AControlValueAccessor, useExisting: forwardRef(() => DateTimeInputComponent) },
        { provide: NgbDateAdapter, useClass: DatetimeAdapter },
        { provide: NgbDatepickerI18n, useClass: CustomDatepickerI18n }
    ],
    host: { class: 'pz-input', '[class.disabled]': 'disabled' }
})
export class DateTimeInputComponent extends AControlValueAccessor<Date> implements Validator {
    showTimezones: boolean;

    @Input('timezone') set timezonesInput(value: boolean) {
        this.showTimezones = value;
    }

    showTimeInput: boolean;

    @Input('time') set timeInput(value: boolean) {
        this.showTimeInput = value;
    }

    maxDate: NgbDateStruct;

    @Input('maxDate') set maxDateInput(value: Date) {
        if (!value || !(value instanceof Date)) {
            return;
        }
        this.maxDate = { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
    }

    minDate: NgbDateStruct;

    @Input('minDate') set minDateInput(value: Date) {
        if (!value || !(value instanceof Date)) {
            return;
        }
        this.minDate = { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
    }

    @Input() minValidDate: Date;
    @Input() maxValidDate: Date;
    @Input() fromDate: Date;
    @Input() toDate: Date;
    @Input() placeholder: string;
    @Input() placement: string = 'bottom-left';
    date: Date = new Date();
    time: Time = new Time(1, 0);
    period: Period = Period.AM;
    periodsList = [
        {
            label: PERIOD_TITLE_MAP[Period.AM],
            value: Period.AM
        },
        {
            label: PERIOD_TITLE_MAP[Period.PM],
            value: Period.PM
        }
    ];
    timezone: string = DEFAULT_TIMEZONE;
    inputTimezone: string = DEFAULT_TIMEZONE;
    timezonesList = TIMEZONES;
    private dateAdapter = new DatetimeAdapter();

    constructor(private calendar: NgbCalendar) {
        super();
        this.initControl(this.inputValue);
    }

    initControl(value: Date) {
        if (value) {
            this.date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
            let hours = value.getHours();
            this.time = new Time(hours % 12 || 12, value.getMinutes());
            this.period = hours > 11 ? Period.PM : Period.AM;
            this.timezone = DEFAULT_TIMEZONE;
        } else {
            this.reset();
        }
    }

    validate(control: AbstractControl): ValidationErrors {
        if (!this.inputValue) {
            return null;
        }
        if (this.minValidDate) {
            let minDate = this.showTimeInput
                ? this.minValidDate
                : new Date(this.minValidDate.getFullYear(), this.minValidDate.getMonth(), this.minValidDate.getDate());

            return this.inputValue < minDate
                ? {
                      mindate: {
                          valid: false,
                          message: 'Wrong Date'
                      }
                  }
                : null;
        }
        if (this.maxValidDate) {
            let maxDate = this.showTimeInput
                ? this.maxValidDate
                : new Date(this.maxValidDate.getFullYear(), this.maxValidDate.getMonth(), this.maxValidDate.getDate());

            return this.inputValue > maxDate
                ? {
                      maxdate: {
                          valid: false,
                          message: 'Wrong Date'
                      }
                  }
                : null;
        }

        return null;
    }

    padTime(timeVal: number) {
        return _padStart(timeVal, 2, '0');
    }

    increaseHours() {
        this.time.hours = this.time.hours < 12 ? this.time.hours + 1 : 1;
    }

    decreaseHours() {
        this.time.hours = this.time.hours > 1 ? this.time.hours - 1 : 12;
    }

    onHoursChange(event) {
        let val = event.target.value;
        if (1 <= +val && +val <= 12) {
            this.time.hours = +val;
        } else {
            event.target.value = this.padTime(this.time.hours);
        }
    }

    increaseMinutes() {
        this.time.minutes = this.time.minutes < 59 ? this.time.minutes + 1 : 0;
    }

    decreaseMinutes() {
        this.time.minutes = this.time.minutes > 0 ? this.time.minutes - 1 : 59;
    }

    onMinutesChange(event) {
        let val = event.target.value;
        if (0 <= +val && +val <= 59) {
            this.time.minutes = +val;
        } else {
            event.target.value = this.padTime(this.time.minutes);
        }
    }

    getDateFormat() {
        return this.showTimeInput ? 'MMMM d, y, h:mma ' : 'MMMM d, y ';
    }

    getRangeClass(date: NgbDate): string {
        let classes: string[] = [];
        let currentSelectedDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.date);
        if (this.fromDate) {
            let fromDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.fromDate);
            if (
                (date.after(fromDateStruct) || date.equals(fromDateStruct)) &&
                (date.before(currentSelectedDateStruct) || date.equals(currentSelectedDateStruct))
            ) {
                classes.push(RANGE_CLASS);
                if (date.equals(fromDateStruct) || this.calendar.getWeekday(date) === 7) {
                    classes.push(RANGE_START_CLASS);
                }
                if (date.equals(currentSelectedDateStruct) || this.calendar.getWeekday(date) === 6) {
                    classes.push(RANGE_END_CLASS);
                }
            }
        }
        if (this.toDate) {
            let toDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.toDate);
            if (
                (date.after(currentSelectedDateStruct) || date.equals(currentSelectedDateStruct)) &&
                (date.before(toDateStruct) || date.equals(toDateStruct))
            ) {
                classes.push(RANGE_CLASS);
                if (date.equals(currentSelectedDateStruct) || this.calendar.getWeekday(date) === 7) {
                    classes.push(RANGE_START_CLASS);
                }
                if (date.equals(toDateStruct) || this.calendar.getWeekday(date) === 6) {
                    classes.push(RANGE_END_CLASS);
                }
            }
        }

        return classes.join(' ');
    }

    isSelected(date: NgbDate): boolean {
        if (!this.date) {
            return false;
        }
        let currentSelectedDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.date);
        if (date.equals(currentSelectedDateStruct)) {
            return true;
        }
        if (this.fromDate) {
            let fromDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.fromDate);

            return date.equals(fromDateStruct);
        }
        if (this.toDate) {
            let toDateStruct: NgbDateStruct = this.dateAdapter.fromModel(this.toDate);

            return date.equals(toDateStruct);
        }
    }

    onDateChange(event: Date, datepicker: NgbInputDatepicker) {
        this.date = event;
        if (!this.showTimeInput) {
            this.submit(datepicker);
        }
    }

    writeValue(value: Date) {
        super.writeValue(value);
        this.initControl(value);
    }

    openPicker(datepicker: NgbInputDatepicker) {
        this.initControl(this.inputValue);
        datepicker.open();
    }

    clear(datepicker: NgbInputDatepicker) {
        this.reset();
        this.submit(datepicker);
    }

    reset() {
        this.date = null;
        this.time = new Time(1, 0);
        this.period = Period.AM;
        this.timezone = DEFAULT_TIMEZONE;
    }

    submit(datepicker: NgbInputDatepicker) {
        this.inputValue = this.getFullDate();
        this.inputTimezone = this.timezone;
        if (!this.showTimeInput) {
            this.propagateChange(this.inputValue);
        } else {
            const resultValue = this.applyOffset(this.inputValue);
            this.propagateChange(resultValue);
        }
        datepicker.close();
    }

    getCurrentTimezoneOffset(): number {
        if (!this.showTimezones) {
            return 0;
        }

        return this.timezonesList.find((tz) => tz.abbreviation === this.timezone).utcOffsetMin;
    }

    applyOffset(date: Date): Date {
        return new Date(date.getTime() - this.getCurrentTimezoneOffset() * 60 * 1000);
    }

    getFullDate(): Date {
        if (!this.date) {
            return null;
        }
        if (!this.showTimeInput) {
            return new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate());
        }
        let hours =
            this.period === Period.AM
                ? this.time.hours === 12
                    ? 0
                    : this.time.hours
                : this.time.hours === 12
                ? 12
                : this.time.hours + 12;

        return new Date(this.date.getFullYear(), this.date.getMonth(), this.date.getDate(), hours, this.time.minutes);
    }
}
