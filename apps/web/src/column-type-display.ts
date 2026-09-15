import type { Column, DesignDocument } from '@ezerd/model';
export function columnTypeDisplay(type:Column['physical']['type'], enums:DesignDocument['enums']=[]) {
 let label=type.enumId?enums?.find(item=>item.id===type.enumId)?.name??'ENUM':type.name;
 if(!type.enumId){if(type.length!==undefined)label+='('+type.length+')';else if(type.precision!==undefined)label+='('+type.precision+(type.scale===undefined?'':','+type.scale)+')';}
 return label.toUpperCase()+(type.isArray?'[]':'');
}
