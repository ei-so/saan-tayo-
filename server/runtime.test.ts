import {it,expect} from 'vitest'
import ts from 'typescript'
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

it('loads compiled place normalization in Node without TypeScript source files',()=>{
  const root=mkdtempSync(join(tmpdir(),'saantayo-runtime-'))
  try{
    const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile)
    const options=ts.convertCompilerOptionsFromJson(config.config.compilerOptions,'.').options
    writeFileSync(join(root,'package.json'),'{"type":"module"}')
    for(const file of ['src/domain','server/places']){
      mkdirSync(join(root,file.split('/')[0]),{recursive:true})
      writeFileSync(join(root,file+'.js'),ts.transpileModule(readFileSync(file+'.ts','utf8'),{compilerOptions:options,fileName:file+'.ts'}).outputText)
    }
    const result=spawnSync(process.execPath,['--input-type=module','-e',"import {fromRestaurant} from './server/places.js'; console.log(fromRestaurant({id:'osm:node:1',source:'osm',updatedAt:'2026-10-15'}).provenance[0].source)"],{cwd:root,encoding:'utf8'})
    expect(result.status,result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('osm')
  }finally{rmSync(root,{recursive:true,force:true})}
})
