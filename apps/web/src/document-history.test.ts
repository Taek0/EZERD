import { expect, it } from 'vitest';
import { DocumentHistory, documentEditGroup, mergeHistoryViewports } from './document-history.js';
import { createEmptyDocument } from '@ezerd/model';
it('groups one edit gesture and keeps branching undo/redo snapshots independent',()=>{
 const h=new DocumentHistory({value:0},2);const next={value:1};h.record(next,'name');next.value=9;h.record({value:2},'name');
 expect(h.undo()).toEqual({value:0});expect(h.redo()).toEqual({value:2});
 h.endGroup();h.record({value:3},'name');expect(h.undo()).toEqual({value:2});h.record({value:4});expect(h.canRedo).toBe(false);
 h.record({value:5});h.record({value:6});expect(h.undo()).toEqual({value:5});expect(h.undo()).toEqual({value:4});expect(h.undo()).toBeNull();
});
it('ignores no-op records and resets between projects',()=>{
 const h=new DocumentHistory({value:0});expect(h.record({value:0})).toBe(false);h.record({value:1});h.undo();h.replaceCurrent({value:2});expect(h.canRedo).toBe(true);h.reset({value:10});expect(h.canUndo).toBe(false);expect(h.canRedo).toBe(false);
});
it('classifies viewport-only changes and groups first route movement with subsequent movement',()=>{
 const doc=createEmptyDocument();const moved={...doc,layout:{...doc.layout,viewports:[{viewId:'overview',x:20,y:30,zoom:1}]}};
 expect(documentEditGroup(doc,moved)).toBe('@viewport');
 const routed={...doc,layout:{...doc.layout,relations:[{relationId:'r',viewId:'overview',offset:0,bend:{x:10,y:20}}]}};
 const again={...routed,layout:{...routed.layout,relations:[{relationId:'r',viewId:'overview',offset:0,bend:{x:20,y:30}}]}};
 expect(documentEditGroup(doc,routed)).toBe(documentEditGroup(routed,again));
});
it('preserves current camera without restoring viewports for removed views',()=>{
 const doc=createEmptyDocument();const now={...doc,layout:{...doc.layout,viewports:[{viewId:'overview',x:40,y:30,zoom:.7},{viewId:'gone',x:0,y:0,zoom:1}]}};
 expect(mergeHistoryViewports(doc,now).layout.viewports).toEqual([now.layout.viewports[0]]);
});
