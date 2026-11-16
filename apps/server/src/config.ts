import dotenv from 'dotenv';
import {resolve} from 'node:path';
// Works from compiled dist/ and from src/; the .env stays at repository root.
dotenv.config({path:resolve(import.meta.dirname,'../../../.env')});
