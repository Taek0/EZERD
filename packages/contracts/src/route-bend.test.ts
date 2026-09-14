import { expect, it } from 'vitest';
import { relationLayoutSchema } from './workspace.js';
it('round trips old offsets and optional free-route bend coordinates',()=>{
 const old={relationId:'r',viewId:'d',offset:32};expect(relationLayoutSchema.parse(old)).toEqual(old);
 const next={...old,bend:{x:-550.5,y:360}};expect(relationLayoutSchema.parse(next)).toEqual(next);
 expect(relationLayoutSchema.safeParse({...old,bend:{x:Infinity,y:0}}).success).toBe(false);
 expect(relationLayoutSchema.safeParse({...old,bend:{x:0,y:1e8}}).success).toBe(false);
});
