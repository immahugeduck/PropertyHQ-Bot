import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryHandler } from '../api/coordinator/deliver.js';
const response=()=>({statusCode:200,status(n){this.statusCode=n;return this;},json(j){this.body=j;return this;},setHeader(){}});
test('worker refuses requests without a configured secret, or wrong authorization',async()=>{let calls=0;for(const env of [{},{COORDINATOR_DELIVERY_SECRET:'fixture'}]){const res=response();await createDeliveryHandler({env,dispatch:async()=>{calls++;}})({method:'POST',headers:{}},res);assert.equal(res.statusCode,401);}assert.equal(calls,0);});
test('worker is scoped to configured Twilio number and needs explicit outbound gate',async()=>{const res=response();await createDeliveryHandler({env:{COORDINATOR_DELIVERY_SECRET:'fixture'},dispatch:async()=>{throw Error('no');}})({method:'POST',headers:{authorization:'Bearer fixture'}},res);assert.equal(res.statusCode,503);});
