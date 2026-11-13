// Strict model output contract. Application policy validates every proposed action.
export const intentTypes=['collect_contact','request_status','new_request','request_manager_review','add_details','offer_times','choose_time','request_alternatives','start_work','report_progress','complete_work','staff_event','clarify'];
const nullableString={type:['string','null']};
const factsSchema = {
  type: ['object','null'], additionalProperties: false,
  required: ['issue','leakPattern','entryPermission','availability','mainDoorSecure','updateWhenHome','repairSummary','accessNotes'],
  properties: {
    issue: {type:['string','null'],enum:['washer','screen_door','window_screen','sink_disposal','other',null]},
    leakPattern: {type:['string','null'],enum:['only_when_used','continuous','uncertain','none',null]},
    entryPermission: {type:['boolean','null']}, availability: nullableString,
    mainDoorSecure: {type:['boolean','null']}, updateWhenHome: {type:['boolean','null']},repairSummary:nullableString,accessNotes:nullableString
  }
};
export const intentSchema = {
  type:'object', additionalProperties:false, required:['type','jobId','fields'],
  properties: {
    type:{type:'string',enum:intentTypes}, jobId:nullableString,
    fields: {
      type:'object', additionalProperties:false,
      required:['eventTitle','appointmentEnd','facts','appointmentStart','nextQuestion','filter','description','name','address','phone','tenantId','choice','proposalVersion','options'],
      properties: {
        eventTitle:nullableString,appointmentEnd:nullableString,facts:factsSchema, appointmentStart:nullableString,
        nextQuestion:{type:['string','null'],enum:['when_started','where_in_home','photo',null]},
        filter:{type:['string','null'],enum:['open','in_progress','completed','awaiting_scheduling','scheduled','today','this_week','next_week',null]},
        description:nullableString,name:nullableString,address:nullableString,phone:nullableString,tenantId:nullableString,
        choice:{type:['integer','null']},proposalVersion:{type:['integer','null']},
        options:{type:['array','null'],items:{type:'object',additionalProperties:false,required:['start','end','flexible','label'],properties:{start:{type:'string'},end:{type:'string'},flexible:{type:'boolean'},label:nullableString}}}
      }
    }
  }
};
