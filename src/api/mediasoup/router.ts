import { Router, Request, Response } from 'express';

const router = Router();
let mediasoupRouter: any = null;

export const setMediasoupRouter = (routerInstance: any) => {
    mediasoupRouter = routerInstance;
};


export default router;
