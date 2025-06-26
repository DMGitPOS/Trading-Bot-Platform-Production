// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as express from 'express';
import { IUser } from '../../models/User';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    export interface User extends IUser {}

    export interface Request {
      user?: User;
    }
  }
} 