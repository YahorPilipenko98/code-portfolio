import { Component, OnInit } from '@angular/core';
import { PartnersService, PartnersTableData } from './partners.service';
import { PartnersDataSource } from './partners.data-source';
import { ResourceType } from '../../@core/data/resources';
import { NgForm } from '@angular/forms';
import { NbToastrService } from '@nebular/theme';
import { RoleService } from '../../@core/services/role.service';
import { Role } from '../../@core/data/role';
import { ActivatedRoute } from '@angular/router';
import { PartnerInfoService } from '../pathner-info/partner-info.service';
import { AuthService } from '../../@core/services/auth.service';

@Component({
  selector: 'pf-partners-table',
  templateUrl: './page-example.component.html',
  styles: [
    `
      nb-card {
        transform: translate3d(0, 0, 0);
      }
    `
  ],
  providers: [PartnersService, PartnerInfoService]
})
export class PartnersComponent implements OnInit {
  settings: object;
  dataDB: PartnersDataSource;

  constructor(
    private infoPartnerService: PartnerInfoService,
    private partnersService: PartnersService,
    public toaster: NbToastrService,
    private roleService: RoleService,
    private authService: AuthService,
    private route: ActivatedRoute
  ) {
    route.queryParamMap.subscribe(params => {
      const partner = params.get('partner');
      this.dataDB = new PartnersDataSource(partnersService);
      if (partner) {
        this.dataDB.search = {
          partner
        };
      }
    });
    this.authService.hasAccess([ResourceType.Admin]).then(isAdmin => {
      this.settings = {
        mode: 'external',
        actions: { add: isAdmin, delete: isAdmin, edit: isAdmin },
        add: {
          addButtonContent: '<i class="nb-plus"></i>',
          createButtonContent: '<i class="nb-checkmark"></i>',
          cancelButtonContent: '<i class="nb-close"></i>'
        },
        edit: {
          editButtonContent: '<i class="nb-edit"></i>',
          saveButtonContent: '<i class="nb-checkmark"></i>',
          cancelButtonContent: '<i class="nb-close"></i>'
        },
        delete: {
          deleteButtonContent: '<i class="nb-trash"></i>',
          confirmDelete: true
        },
        columns: {
          id: {
            title: 'Id',
            type: 'number',
            editable: false
          },
          name: {
            title: 'Name',
            type: 'string'
          },
          email: {
            title: 'Email',
            type: 'string'
          },
          invocations: {
            title: 'Invocations',
            type: 'number',
            editable: false
          },
          admin: {
            title: 'Super Admin',
            type: 'boolean'
          },
          cost: {
            title: 'Cost for camera',
            type: 'number'
          },
          roles: {
            title: 'Roles',
            type: 'html',
            valuePrepareFunction: (cell, row) => {
              return this.createHtmlFromAnArray(row);
            }
          }
        }
      };
    });
  }

  createHtmlFromAnArray(row: any): string {
    const column = row.fullPartnerRoles;
    const columnHTML = column.map(el => {
      return `<dd>${el.name}</dd>`;
    });
    const rolesColumn = columnHTML.join(' ');
    return `<dl>\
                        ${rolesColumn}\
                    </dl>`;
  }

  roles: Role[] = [];
  ResourceType = ResourceType;
  editedPartner: PartnersTableData;
  isShowForm = false;
  isLoading = false;
  isEditForm = false;
  partnerElement: PartnersTableData;

  onDelete(event): void {
    this.dataDB
      .remove(event.data)
      .then(() => {
        this.toaster.success(`Partner id:${event.data.id} Removed`, 'Success');
      })
      .catch(e => {
        this.toaster.danger(e.statusText, e.status);
      });
  }

  closeForm(): void {
    this.isShowForm = false;
    this.isEditForm = false;
  }

  openForm(event) {
    this.editedPartner = {
      name: '',
      email: '',
      admin: false,
      roles: [],
      cost: 0
    };
    this.isShowForm = true;
    if (event.data) {
      this.isEditForm = true;
      for (const key of Object.keys(event.data)) {
        this.editedPartner[key] = event.data[key];
      }
      this.partnerElement = event.data;
    }
  }

  submitForm(form: NgForm): void {
    if (!form.valid) {
      return;
    }
    let activePromise: Promise<void>;
    this.isLoading = true;
    if (this.isEditForm) {
      activePromise = this.dataDB.update(this.partnerElement, this.editedPartner).then(() => {
        this.toaster.success(`Partner id:${this.partnerElement.id} Edited`, 'Success');
        this.isEditForm = false;
      });
    } else {
      activePromise = this.dataDB.prepend(this.editedPartner).then(() => {
        this.toaster.success(`Partner :id ${form.value.id} Created`, 'Success');
      });
    }
    activePromise
      .catch(e => {
        this.toaster.danger(e.statusText, e.status);
      })
      .finally(() => {
        this.closeForm();
        this.isLoading = false;
      });
  }

  ngOnInit() {
    this.roleService.getAllRoles().then(roles => {
      this.roles = roles;
    });
  }
}
