declare module 'express-session' {
  import { RequestHandler } from 'express';

  interface SessionOptions {
    secret: string | string[];
    name?: string;
    resave?: boolean;
    saveUninitialized?: boolean;
    cookie?: {
      maxAge?: number;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: boolean | 'lax' | 'strict' | 'none';
      domain?: string;
      path?: string;
      expires?: Date;
    };
    store?: any;
    rolling?: boolean;
    unset?: 'destroy' | 'keep';
    proxy?: boolean;
  }

  function session(options?: SessionOptions): RequestHandler;

  export = session;
}
