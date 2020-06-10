import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import * as io from 'socket.io-client';
import Socket = SocketIOClient.Socket;
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

interface TransferData {
  type: DataTypes;
  id?: string;
  link?: string;
  data: any;
}

export enum DataTypes {
  LiveUsers = 'live-users'
}

export enum SocketIoEvents {
  MessageEvent = 'messageEvent',
  ListeningEvent = 'listening',
  NotListeningEvent = 'not_listening'
}

@Injectable()
export class WebSocketService {
  private socket: Socket;
  private connectedChannelsTypes: DataTypes[] = [];

  constructor(private authService: AuthService) {}
  public connect(type: DataTypes) {
    const token = this.authService.getJwtToken();
    if (!this.socket) {
      this.socket = io.connect(environment.apiUrl, {
        query: { token: token }
      });
    }
    this.listen(type);
  }

  public disconnect(type: DataTypes) {
    this.unlisten(type);
    if (this.connectedChannelsTypes.length === 0) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public send(type: DataTypes, data?: any) {
    const transferMessage = {
      type,
      data
    };
    this.socket.emit(SocketIoEvents.MessageEvent, transferMessage);
  }

  public receive(type: DataTypes): Observable<any> {
    return new Observable(observer => {
      this.socket.on(SocketIoEvents.MessageEvent, (message: TransferData) => {
        if (message.type === type) {
          observer.next(message.data);
        }
      });
    });
  }

  private listen(type: DataTypes) {
    if (!this.connectedChannelsTypes.includes(type)) {
      this.socket.emit(SocketIoEvents.ListeningEvent, type);
      this.connectedChannelsTypes.push(type);
    }
  }

  private unlisten(type: DataTypes) {
    const idx = this.connectedChannelsTypes.findIndex(s => s === type);
    this.connectedChannelsTypes.splice(idx, 1);
    this.socket.emit(SocketIoEvents.NotListeningEvent, type);
  }
}
