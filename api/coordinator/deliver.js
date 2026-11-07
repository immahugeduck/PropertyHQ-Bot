import { timingSafeEqual } from 'node:crypto';
import { supabaseConfig } from '../../src/supabase.js';
import { loadContext } from '../../src/conversation-store.js';
import { dispatchPending } from '../../src/notifications.js';
export function createDeliveryHandler({env=process.env,dispatch=dispatchPending,load=loadContext}={}) {
  return async function handler(req,res) {
    if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
    const expected=Buffer.from(`Bearer ${env.COORDINATOR_DELIVERY_SECRET || ''}`),supplied=Buffer.from(req.headers.authorization || '');
    if(!env.COORDINATOR_DELIVERY_SECRET || expected.length!==supplied.length || !timingSafeEqual(expected,supplied)) return res.status(401).json({error:'unauthorized'});
    if(env.COORDINATOR_ENABLED!=='true' || env.COORDINATOR_OUTBOUND_ENABLED!=='true') return res.status(503).json({error:'coordinator_disabled'});
    try {
      const context=await load({db:supabaseConfig(env),params:{To:env.TWILIO_NUMBER,From:env.TWILIO_NUMBER}});
      const outcomes=await dispatch({scope:context.scope,db:supabaseConfig(env),env});
      return res.status(200).json({processed:outcomes.length,uncertain:outcomes.filter(x=>x.status==='uncertain').length});
    } catch {return res.status(503).json({error:'delivery_unavailable'});}
  };
}
export default createDeliveryHandler();
