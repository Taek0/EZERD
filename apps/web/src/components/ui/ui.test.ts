import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button, Field, Input, Select, Collapse } from './index.js';

describe('shared UI accessibility and native compatibility', () => {
  it('uses safe default buttons and explicit submit semantics', () => {
    expect(render(h(Button, {}, 'Action'))).toContain('type="button"');
    expect(render(h(Button, {type:'submit'}, 'Save'))).toContain('type="submit"');
    expect(render(h(Button, {disabled:true}, 'No'))).toContain('disabled=""');
    const loading = render(h(Button, {loading:true}, 'Saving'));
    expect(loading).toContain('disabled=""');
    expect(loading).toContain('aria-disabled="true"');
  });
  it('associates label and descriptions while preserving input attributes', () => {
    const html = render(h(Field, {id:'name',label:'Name',hint:'Required',error:'Missing',children:h(Input, {name:'name',required:true,'aria-describedby':'external'})}));
    expect(html).toContain('for="name"');
    expect(html).toContain('id="name"');
    expect(html).toContain('aria-describedby="external name-hint name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('required=""');
  });
  it('keeps native select options and excludes collapsed fields from keyboard navigation', () => {
    expect(render(h(Select, {defaultValue:'a'}, h('option', {value:'a'}, 'Alpha')))).toContain('<option value="a" selected="">');
    expect(render(h(Collapse, {id:'panel',open:false,children:h(Input,{})}))).toContain('inert=""');
  });
});

