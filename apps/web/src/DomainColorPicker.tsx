import { ColorPicker, ColorArea, ColorSlider, ColorThumb, SliderTrack, DialogTrigger, Dialog, ColorSwatch } from 'react-aria-components';
import { Button } from './components/ui/index.js';
import { UntitledPopover } from './components/ui/untitled.js';

// Free React Aria composition, styled to fit the existing Untitled UI primitives.
// The upstream Untitled UI Color Picker is a paid component; its source is not used.
export function DomainColorPicker({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  return <div className="domain-color-field"><span>도메인 색상</span>
    <ColorPicker value={value} onChange={color => onChange(color.toString('hex'))}>
      <DialogTrigger><Button disabled={disabled} aria-label="도메인 색상 선택" className="domain-color-trigger"><ColorSwatch className="domain-color-swatch"/><span>{value.toUpperCase()}</span><span aria-hidden="true">⌄</span></Button>
        <UntitledPopover className="domain-color-popover" placement="bottom start"><Dialog aria-label="도메인 색상 선택">
          <ColorArea className="domain-color-area" colorSpace="hsb" xChannel="saturation" yChannel="brightness"><ColorThumb className="domain-color-thumb"/></ColorArea>
          <ColorSlider className="domain-color-slider" colorSpace="hsb" channel="hue" aria-label="색조"><SliderTrack className="domain-color-track"><ColorThumb className="domain-color-thumb"/></SliderTrack></ColorSlider>
          <label className="domain-color-hex">HEX <input aria-label="HEX 색상" key={value} defaultValue={value.toUpperCase()} maxLength={7} onBlur={event => {const next=event.target.value; if(/^#[0-9a-f]{6}$/i.test(next))onChange(next);else event.target.value=value.toUpperCase();}} onKeyDown={event => {if(event.key==='Enter')event.currentTarget.blur();}} /></label>
          <div className="domain-color-swatches" aria-label="추천 색상">{['#8993a3','#475467','#7f56d9','#465fff','#2e90fa','#06aed4','#12b76a','#f79009','#f04438','#ee46bc'].map(color => <Button key={color} aria-label={`${color} 색상`} aria-pressed={value.toLowerCase()===color} onClick={() => onChange(color)} style={{background:color}} />)}</div>
        </Dialog></UntitledPopover>
      </DialogTrigger>
    </ColorPicker>
  </div>;
}
