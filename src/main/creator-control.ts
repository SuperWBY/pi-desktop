import { randomUUID } from 'node:crypto'
import type { PiProcess } from './pi'
import type { PiRecord } from '@shared/types'
import { CREATOR_COMMAND, decodeCreatorRecord, type CreatorAction, type CreatorResult } from '../../extensions/creator/types.ts'
import { CREATOR_LIMITS } from '../../extensions/creator/config.ts'

/** Pi's prompt ACK means handled, not that an extension command succeeded. Await its explicit result. */
export async function sendCreatorControl(process: PiProcess, input: CreatorAction | {action:'reload'}): Promise<CreatorResult> {
  const requestId=randomUUID()
  let dispose=():void=>{}
  const result=new Promise<CreatorResult>((resolve,reject)=>{
    const finish=(value?:CreatorResult,error?:Error):void=>{dispose();if(error)reject(error);else resolve(value!)}
    const record=(raw:PiRecord):void=>{
      const record=decodeCreatorRecord(raw) as PiRecord
      if(record.type==='extension_ui_request'&&record.method==='creator_result'&&record.id===requestId){
        const result=record.result as CreatorResult|undefined
        if(result&&typeof result.ok==='boolean')finish(result)
      }
    }
    const exited=():void=>finish(undefined,new Error('Pi exited before the creator operation finished.'))
    const timer=setTimeout(()=>finish(undefined,new Error(`Creator operation timed out (${CREATOR_LIMITS.commandMs}ms; PI_CREATOR_COMMAND_MS).`)),CREATOR_LIMITS.commandMs)
    dispose=()=>{clearTimeout(timer);process.off('record',record);process.off('exit',exited)}
    process.on('record',record);process.once('exit',exited)
  })
  try{
    const ack=process.send({type:'prompt',message:`/${CREATOR_COMMAND} ${JSON.stringify({requestId,input})}`},CREATOR_LIMITS.commandMs).then(response=>{if(!response.success)throw new Error(response.error??'Pi rejected the creator command.');return response})
    const [value]=await Promise.all([result,ack])
    return value
  }finally{dispose()}
}
