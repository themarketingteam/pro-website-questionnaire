import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { memoryEntity, copyRecord } from './utils/memoryEntities';
import { loadBackend } from './utils/loadBackend';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
const session = 'automatic_retry_session_123456';
const secret = 'automatic_retry_secret_abcdefghijklmnopqrstuvwxyz';
const credential = `${session}.${secret}`;
const answers = () => ({ '1': 'no', '2': 'no', '3': ['Managed IT','IT Help Desk','Cloud Services'], '3_other': [], '4': ['Healthcare'], '4_other': [], '5': [{ label: 'Chicago, IL' }], '6': 'A saved company description', '12':'no','14':'no','23':'no','25':'no' });
const when = '2026-11-23T21:33:00Z'; // 3:33 PM Central; retries first at 5 PM.
async function fixture({ responses = answers(), businessName = 'Realistic Unit Client', domain = 'customer-unit-testing.net' } = {}) {
  const raw = copyRecord(responses), mapped = transformResponsesToPayload(raw,businessName,domain,SERVICE_OPTIONS_GROUPED);
  const hash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('base64url');
  const entities = Object.fromEntries(['ProFormDraft','ProFormDraftRevision','ProFormSubmission','ProFormSubmissionIntake','ProFormDraftEvent','ProSubmissionRetryJob'].map(name => [name,memoryEntity(name)]));
  const draft = { id:'draft-retry-source',session_id:session,access_token_hash:hash,status:'draft',save_revision:0,business_name:businessName,domain,responses_json:JSON.stringify(raw),mapped_payload_json:JSON.stringify(mapped),validation_status_json:'{}',touched_questions_json:'{}',expanded_questions_json:'{}' };
  entities.ProFormDraft.rows.push(draft);
  let role = 'admin'; const fetchImpl = vi.fn(async () => new Response('{}',{status:200}));
  const sdk = { auth:{ me:vi.fn(async()=> role ? ({ role }) : null) },asServiceRole:{ entities } };
  const intent=loadBackend('base44/functions/registerProSubmissionIntent/entry.ts',{base44:sdk,fetchImpl});
  const submit=loadBackend('base44/functions/submitProQuestionnaireDurable/entry.ts',{base44:sdk,fetchImpl});
  const send=loadBackend('base44/functions/sendToZapier/entry.ts',{base44:sdk,fetchImpl});
  const alias=loadBackend('base44/functions/sendToZapier/entry/entry.ts',{base44:sdk,fetchImpl});
  const worker=loadBackend('base44/functions/processProSubmissionRetries/entry.ts',{base44:sdk,fetchImpl});
  const job=()=>entities.ProSubmissionRetryJob.rows[0];
  const register = (values=raw,context={business_name:businessName,domain})=>intent.send({resumeCredential:credential,responses:values,submitContext:context});
  const create = (payload=mapped)=>submit.send({draftId:draft.id,resumeCredential:credential,submissionAttemptId:'client_submission_attempt_12345',transformedPayload:payload});
  const deliver = (transport=true)=>send.send(transport?{payload:mapped,draftId:draft.id,resumeCredential:credential}:{...mapped,metadata:{...mapped.metadata,source_draft_id:draft.id,questionnaire_session_id:session}});
  return {entities,draft,raw,mapped,sdk,fetchImpl,intent,submit,send,alias,worker,job,register,create,deliver,role:value=>{role=value;} };
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(when));});
afterEach(()=>vi.useRealTimers());
describe('actual Pro automatic submission backend',()=>{
 it('captures an explicit raw intent before receipt creation and finishes overdue work after browser closure',async()=>{
  const f=await fixture(); expect((await f.register()).body.intentConfirmed).toBe(true); expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
  vi.setSystemTime(new Date('2026-11-23T23:08:00Z')); const result=await f.worker.send({dryRun:false});
  expect(result.status).toBe(200);expect(f.entities.ProFormSubmission.rows).toHaveLength(1);expect(f.fetchImpl).toHaveBeenCalledOnce();expect(f.job().status).toBe('succeeded');
  expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body).userdata.company_description).toBe('A saved company description');
 });
 it('recovers frozen newest answers and client identity after final-save500 only while the captured baseline is unchanged',async()=>{
  const f=await fixture({responses:{},businessName:'',domain:''}); const latest=answers();latest['6']='Explicit newest submitted text';
  expect((await f.register(latest,{business_name:'New Client',domain:'new-client-unit.net'})).status).toBe(200);
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});
  expect(f.fetchImpl).toHaveBeenCalledOnce();expect(JSON.parse(f.draft.responses_json)['6']).toBe('Explicit newest submitted text');expect(f.draft.business_name).toBe('New Client');
  expect(f.entities.ProFormDraftRevision.rows[0].source).toBe('automatic_frozen_submission');expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
 });
 it('holds a rejected409/validation intent even when raw answers happen to equal the server baseline',async()=>{
  const f=await fixture();await f.register();await f.intent.send({resumeCredential:credential,responses:f.raw,failure:{status:409,failureKind:'identity',message:'Rejected final save'},submitContext:{business_name:f.draft.business_name,domain:f.draft.domain}});
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);expect(f.job().status).toBe('needs_review');
 });
 it('does not submit later unconfirmed edits or a changed identity',async()=>{
  const f=await fixture();await f.register();f.draft.responses_json=JSON.stringify({...f.raw,'6':'Later unsent edit'});f.draft.save_revision=1;
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.job().status).toBe('needs_review');expect(JSON.parse(f.draft.responses_json)['6']).toBe('Later unsent edit');
 });
 it('reuses one receipt under overlapping workers and public/legacy delivery calls',async()=>{
  const f=await fixture();await f.register();expect((await f.create()).status).toBe(200);
  const [a,b]=await Promise.all([f.deliver(),f.alias.send({payload:f.mapped,draftId:f.draft.id,resumeCredential:credential})]);
  expect(a.status).toBe(200);expect(b.status).toBe(200);expect(f.entities.ProFormSubmission.rows).toHaveLength(1);expect(f.fetchImpl).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date('2026-11-24T01:00:00Z'));await Promise.all([f.worker.send({dryRun:false}),f.worker.send({dryRun:false})]);expect(f.fetchImpl).toHaveBeenCalledOnce();
 });
 it('reschedules a known HTTP500 to5PM and does not let a credentialed browser retry before due',async()=>{
  const f=await fixture();await f.register();await f.create();f.fetchImpl.mockResolvedValueOnce(new Response('{}',{status:500}));
  expect((await f.deliver()).status).toBe(502);expect(f.job().next_retry_at).toBe('2026-11-23T23:00:00.000Z');
  await f.create();vi.setSystemTime(new Date('2026-11-23T22:05:00Z'));await f.intent.send({resumeCredential:credential,responses:f.raw,submitContext:{business_name:f.draft.business_name,domain:f.draft.domain},failure:{status:503,message:'Duplicate browser failure'}});expect(f.job().next_retry_at).toBe('2026-11-23T23:00:00.000Z');expect((await f.deliver()).body.code).toBe('RETRY_NOT_DUE');expect(f.fetchImpl).toHaveBeenCalledOnce();
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).toHaveBeenCalledTimes(2);expect(f.job().status).toBe('succeeded');
 });
 it('holds transport timeouts and preserves that hold through repeated durable receipt retries',async()=>{
  const f=await fixture();await f.register();await f.create();f.fetchImpl.mockRejectedValueOnce(Object.assign(new Error('Timeout'),{name:'AbortError'}));
  expect((await f.deliver()).body.code).toBe('DELIVERY_UNKNOWN');expect(f.job().status).toBe('delivery_unknown');
  await f.create();await f.deliver();vi.setSystemTime(new Date('2026-11-24T01:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).toHaveBeenCalledOnce();expect(f.job().status).toBe('delivery_unknown');
 });
 it('keeps dry-run and unauthorized workers free of mutations, locks and deliveries',async()=>{
  const f=await fixture();await f.register();vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));const before=copyRecord(Object.fromEntries(Object.entries(f.entities).map(([name,entity])=>[name,entity.rows])));
  expect((await f.worker.send({dryRun:true})).status).toBe(200);expect((await f.worker.send({})).body.dryRun).toBe(true);expect(Object.fromEntries(Object.entries(f.entities).map(([name,entity])=>[name,entity.rows]))).toEqual(before);expect(f.fetchImpl).not.toHaveBeenCalled();
  f.role('user');expect((await f.worker.send({dryRun:false})).status).toBe(403);f.role('');expect((await f.worker.send({dryRun:false})).status).toBe(401);
 });
 it('excludes synthetic validation fixtures and explicit holds under the send lock',async()=>{
  const f=await fixture({businessName:'SYNTHETIC DO NOT DELIVER',domain:'sample.example.test'});await f.register();await f.create();await f.deliver();expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.job().status).toBe('excluded');
  const real=await fixture();await real.register();await real.create();real.draft.legal_hold=true;await real.deliver();expect(real.fetchImpl).not.toHaveBeenCalled();
 });
 it('does not create a deliverable job after an invalid supplied content fingerprint',async()=>{
  const f=await fixture();await f.register();const rejected=await f.submit.send({draftId:f.draft.id,resumeCredential:credential,submissionAttemptId:'client_submission_attempt_12345',transformedPayload:f.mapped,submissionContentFingerprint:'tampered'});expect(rejected.status).toBe(409);
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);expect(f.job().status).toBe('needs_review');
 });
 it('rejects tampered frozen snapshots before creating any receipt',async()=>{
  const f=await fixture();await f.register();f.job().raw_responses_json=JSON.stringify({...f.raw,'6':'Altered frozen answer'});
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);expect(f.job().status).toBe('needs_review');
 });
 it('holds a crashed processing delivery when a credentialed public sender resumes it',async()=>{
  const f=await fixture();await f.register();await f.create();Object.assign(f.job(),{status:'processing',delivery_started_at:when,last_attempt_at:when});
  expect((await f.deliver()).body.code).toBe('DELIVERY_UNKNOWN');expect(f.job().status).toBe('delivery_unknown');expect(f.fetchImpl).not.toHaveBeenCalled();
 });
 it('never resends accepted HTTP after a delivery-ledger acknowledgement failure',async()=>{
  const f=await fixture();await f.register();await f.create();const update=f.entities.ProSubmissionRetryJob.update.getMockImplementation();
  f.entities.ProSubmissionRetryJob.update.mockImplementation(async(id,value)=>{if(value.status==='succeeded')throw new Error('ACK write failed');return update(id,value);});
  expect((await f.deliver()).body.code).toBe('DELIVERY_ACK_UNKNOWN');expect(f.entities.ProFormSubmission.rows[0].automatic_delivery_status).toBe('accepted');
  await f.deliver();vi.setSystemTime(new Date('2026-11-24T01:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).toHaveBeenCalledOnce();
 });
 it('recovers a receipt-create ACK loss without creating or sending duplicate accepted submissions',async()=>{
  const f=await fixture();await f.register();const create=f.entities.ProFormSubmission.create.getMockImplementation();
  f.entities.ProFormSubmission.create.mockImplementationOnce(async value=>{await create(value);throw Object.assign(new Error('Create ACK lost'),{status:503});});
  expect((await f.create()).status).toBe(503);expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.entities.ProFormSubmission.rows).toHaveLength(1);expect(f.fetchImpl).toHaveBeenCalledOnce();expect(f.job().status).toBe('succeeded');
 });
 it('recovers a missing job only from a new receipt atomic pending marker',async()=>{
  const f=await fixture();await f.register();await f.create();f.entities.ProSubmissionRetryJob.rows.splice(0);expect(f.entities.ProFormSubmission.rows[0].automatic_retry_outbound_payload_json).toBeTruthy();
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.entities.ProFormSubmission.rows).toHaveLength(1);expect(f.fetchImpl).toHaveBeenCalledOnce();expect(f.job().status).toBe('succeeded');
 });
 it('scans beyond held first pages and keeps historical failures without stable attempts in review',async()=>{
  const f=await fixture();f.draft.status='submit_failed';f.draft.last_saved_at='2026-05-19T12:00:00Z';
  for(let index=0;index<105;index++)f.entities.ProFormDraft.rows.push({...copyRecord(f.draft),id:`held-${index}`,legal_hold:true,last_saved_at:'2026-05-11T12:00:00Z'});
  const before=copyRecord(f.entities.ProSubmissionRetryJob.rows);const dry=await f.worker.send({dryRun:true});expect(dry.body.inventory.scanned).toBe(106);expect(dry.body.inventory.excluded).toBe(105);expect(dry.body.inventory.needsReview).toBe(1);expect(f.entities.ProSubmissionRetryJob.rows).toEqual(before);
  const actual=await f.worker.send({dryRun:false});expect(actual.body.inventory.admitted).toBe(1);expect(f.job().status).toBe('needs_review');expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });
 it('persists a review hold on an actual final-save409 even if the browser never reports its failure',async()=>{
  const tree=label=>({format:'page-tree-v1',pages:[{id:'custom-service',label,source:'custom',catalogId:null,children:[]}]});
  const original={...answers(),'3':[],'3_other':['Original service'],'3_structure':tree('Original service')};const f=await fixture({responses:original});const attempt={...original,'3_other':['Latest service'],'3_structure':tree('Latest service')};await f.register(attempt);
  const save=loadBackend('base44/functions/syncProQuestionnaireDraft/entry.ts',{base44:f.sdk,fetchImpl:f.fetchImpl});
  const rejected=await save.send({action:'save',draftId:f.draft.id,resumeCredential:credential,source:'final_submission_barrier',clientInstanceId:'actual_final_save_client',mutationId:'actual_final_save_mutation',clientSequence:1,baseRevision:99,changedKeys:Object.keys(attempt),responses:attempt,credentials:{businessName:f.draft.business_name,domain:f.draft.domain}});
  expect(rejected.status).toBe(409);expect(f.job().status).toBe('needs_review');vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });
 it('validates reconstructed payload field types with the same generic validator as the browser',async()=>{
  const f=await fixture();await f.register();f.job().mapped_payload_json=JSON.stringify({...f.mapped,userdata:{...f.mapped.userdata,additional_pages_list:{}}});f.job().outbound_payload_json=f.job().mapped_payload_json;
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.job().status).toBe('needs_review');expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });

 it('rejects a different nonblank client identity before registration and never changes the secured source',async()=>{
  const f=await fixture();const identity={business_name:f.draft.business_name,domain:f.draft.domain};
  const rejected=await f.register(f.raw,{business_name:'Other Client',domain:'other-client-unit.net'});expect(rejected.status).toBe(409);expect(rejected.body.code).toBe('SUBMISSION_IDENTITY_CONFLICT');expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);expect({business_name:f.draft.business_name,domain:f.draft.domain}).toEqual(identity);
 });

 it('holds the original registered intent when a final payload is rejected by organizer validation',async()=>{
  const f=await fixture();await f.register();const bad={...f.mapped,metadata:{...f.mapped.metadata,questionnaire_payload_version:99}};
  expect((await f.create(bad)).status).toBe(400);expect(f.job().status).toBe('needs_review');vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });

 it('holds a same-answer pending revision whose retained identity differs from the frozen new-client intent',async()=>{
  const f=await fixture({responses:{},businessName:'',domain:''});const raw=answers();await f.register(raw,{business_name:'Confirmed Client',domain:'confirmed-client-unit.net'});
  f.entities.ProFormDraftRevision.rows.push({id:'pending-wrong-identity',draft_id:f.draft.id,server_revision:1,source:'final_submission_barrier',result_snapshot_json:JSON.stringify({responses:raw,credentials:{businessName:'Different Client',domain:'different-client-unit.net'}})});
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.job().status).toBe('needs_review');expect(f.draft.business_name).toBe('');expect(JSON.parse(f.draft.responses_json)).toEqual({});expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });

 it('supersedes older unsubmitted A when valid B final-save500 leaves A as the saved baseline',async()=>{
  const f=await fixture();await f.register();const prior=copyRecord(f.job());const latest={...f.raw,'6':'Newest explicitly submitted B'};
  expect((await f.register(latest)).status).toBe(200);expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(2);expect(f.entities.ProSubmissionRetryJob.rows[0].status).toBe('cancelled');expect(f.entities.ProSubmissionRetryJob.rows[0].raw_responses_json).toBe(prior.raw_responses_json);
  const b=f.entities.ProSubmissionRetryJob.rows[1];expect(b.intent_sequence).toBeGreaterThan(prior.intent_sequence);await f.register(latest);expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(2);
  expect((await f.create()).status).toBe(409);expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.fetchImpl).toHaveBeenCalledOnce();expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body).userdata.company_description).toBe('Newest explicitly submitted B');expect(f.entities.ProFormSubmission.rows).toHaveLength(1);expect(b.status).toBe('succeeded');
 });
 it('fences old A even if B job creation succeeds but the A cancellation write fails',async()=>{
  const f=await fixture();await f.register();const a=f.job();const update=f.entities.ProSubmissionRetryJob.updateMany.getMockImplementation();
  f.entities.ProSubmissionRetryJob.updateMany.mockImplementationOnce(async()=>{throw Object.assign(new Error('Cancellation ACK failed'),{status:503});});
  expect((await f.register({...f.raw,'6':'Frozen B after cancellation failure'})).status).toBe(503);expect(a.status).toBe('queued');expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(2);
  f.entities.ProSubmissionRetryJob.updateMany.mockImplementation(update);vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(a.status).toBe('cancelled');expect(f.fetchImpl).toHaveBeenCalledOnce();expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body).userdata.company_description).toBe('Frozen B after cancellation failure');
 });
 it('keeps admitted B as a barrier to A after B later requires review, and old A cannot revive by callback',async()=>{
  const f=await fixture();await f.register();const update=f.entities.ProSubmissionRetryJob.updateMany.getMockImplementation();f.entities.ProSubmissionRetryJob.updateMany.mockImplementationOnce(async()=>{throw new Error('cancel failed');});
  const latest={...f.raw,'6':'B then rejected'};await f.register(latest);f.entities.ProSubmissionRetryJob.updateMany.mockImplementation(update);await f.intent.send({resumeCredential:credential,responses:latest,submitContext:{business_name:f.draft.business_name,domain:f.draft.domain},failure:{status:409,message:'Final save rejected'}});
  vi.setSystemTime(new Date('2026-11-23T23:00:00Z'));await f.worker.send({dryRun:false});expect(f.entities.ProSubmissionRetryJob.rows[0].status).toBe('cancelled');expect(f.entities.ProSubmissionRetryJob.rows[1].status).toBe('needs_review');expect((await f.register()).status).toBe(409);expect(f.fetchImpl).not.toHaveBeenCalled();expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
 });
 it('does not supersede A when B is malformed, identity-conflicting, excluded, or first reported as rejected',async()=>{
  const f=await fixture();await f.register();const a=f.job();
  expect((await f.register({...f.raw,'3_structure':{format:'broken',pages:[]}})).status).toBe(422);expect((await f.register({...f.raw,'6':'B'},{business_name:'Wrong Client',domain:'wrong-client.net'})).status).toBe(409);expect(a.status).toBe('queued');
  f.draft.delivery_hold=true;expect((await f.register({...f.raw,'6':'Excluded B'})).status).toBe(200);f.draft.delivery_hold=false;expect(a.status).toBe('queued');expect(f.entities.ProSubmissionRetryJob.rows[1]).toMatchObject({status:'excluded',intent_sequence:0});
  await f.intent.send({resumeCredential:credential,responses:{...f.raw,'6':'Rejected before admission'},submitContext:{business_name:f.draft.business_name,domain:f.draft.domain},failure:{status:409,message:'Rejected'}});expect(a.status).toBe('queued');expect(f.entities.ProSubmissionRetryJob.rows[2]).toMatchObject({status:'needs_review',intent_sequence:0});
 });
 it('preserves prior manual, review, HTTP-started and receipt-linked jobs rather than superseding them',async()=>{
  for(const protectedFields of [{status:'needs_review'},{manual_force:true},{delivery_started_at:when},{submission_id:'already-retained'},{stage:'delivery'},{delivery_accepted_at:when,status:'succeeded'}]){
   const f=await fixture();await f.register();Object.assign(f.job(),protectedFields);const prior=copyRecord(f.job());await f.register({...f.raw,'6':'Newer B'});expect(f.entities.ProSubmissionRetryJob.rows[0]).toEqual(prior);
  }
 });

});
