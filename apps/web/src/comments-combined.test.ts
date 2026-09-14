import { expect, it } from 'vitest';
import { createEmptyDocument } from '@ezerd/model';
import { pinPosition } from './comments-state.js';
it('recognizes combined view pins and removed views', () => {
 const doc={...createEmptyDocument(),views:[{id:'combined',name:'함께 보기',domainIds:['d']}]};
 const pin={viewId:'combined',objectId:null,x:32,y:54};
 expect(pinPosition(doc,pin)).toEqual({x:32,y:54,missing:false});
 expect(pinPosition({...doc,views:[]},pin).missing).toBe(true);
});
