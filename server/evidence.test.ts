import {describe,it,expect} from 'vitest'
import {validateExtraction} from './evidence'
const text='FICTIONAL TEST MENU\nCuisine: Filipino\nAdobo — PHP 120 per serving\nOpening hours: 09:00–18:00\nNot a halal restaurant. Vegetarian options available.'
describe('grounded pending evidence',()=>{
 it('keeps explicit contextual menu price pending',()=>{const r=validateExtraction({claims:[{kind:'price',value:'120',subject:'Adobo',currency:'PHP',unit:'per serving',quote:'Adobo — PHP 120 per serving'}]},text);expect(r.issues).toEqual([]);expect(r.status).toBe('pending_review')})
 it.each([
  {kind:'price',value:'200',subject:'Adobo',currency:'PHP',unit:'per serving',quote:'Adobo — PHP 120 per serving'},
  {kind:'price',value:'120',subject:'Adobo',currency:'USD',unit:'per serving',quote:'Adobo — PHP 120 per serving'},
  {kind:'dietary',value:'halal',quote:'Not a halal restaurant.'},
  {kind:'dietary',value:'vegetarian',quote:'Vegetarian options available.'},
  {kind:'cuisine',value:'Japanese',quote:'Cuisine: Filipino'},
  {kind:'hours',value:'24 hours',quote:'Opening hours: 09:00–18:00'},
  {kind:'menu',value:'Pizza',quote:'Invented Pizza'},
 ])('rejects invented, unrelated and ambiguous facts',claim=>expect(validateExtraction({claims:[claim]},text).issues.length).toBeGreaterThan(0))
 it('rejects malformed claims',()=>expect(validateExtraction({claims:[null]},text).issues.length).toBeGreaterThan(0))
 it.each([
  {source:'It is false that Restaurant is halal-certified.',claim:{kind:'dietary',value:'halal',quote:'Restaurant is halal-certified.'}},
  {source:'NOT Cuisine: Filipino',claim:{kind:'cuisine',value:'Filipino',quote:'Cuisine: Filipino'}},
 ])('rejects negated substrings',({source,claim})=>{const r=validateExtraction({claims:[claim]},source);expect(r.claims).toEqual([]);expect(r.issues.length).toBeGreaterThan(0)})
})
