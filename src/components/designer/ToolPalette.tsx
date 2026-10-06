import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Ruler } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { ToolRail } from './ToolRail';
import { ToolSettings } from './ToolSettings';

export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history: ReactNode; view: ReactNode }) {
  const pop = usePopover();
  const tool = useStore((s) => s.ui.tool);
  const pickedTool = useRef(tool);
  useEffect(() => { if (pickedTool.current !== tool) pop.close(); }, [tool, pop.close]);
  const rulers = useStore((s) => s.ui.rulers ?? false);
  const pick = (button: HTMLButtonElement) => {
    const next = useStore.getState().ui.tool;
    const same = pop.ref.current === button && pickedTool.current === next;
    pickedTool.current = next;
    pop.ref.current = button;
    pop.setOpen(!(same && pop.open));
  };
  return <>
    <div className="designer-palette">
      <ToolRail doc={settings.doc} onPick={pick}><div className="palette-history">{history}</div></ToolRail>
    </div>
    <div className="designer-view" role="toolbar" aria-label="Canvas view">
      <IconButton icon={Ruler} label={`${rulers ? 'Hide' : 'Show'} rulers and guides (Shift+R)`} active={rulers} aria-pressed={rulers} size="sm" onClick={() => setUi({ rulers: !rulers })} />
      {view}
    </div>
    <Popover key={tool} open={pop.open && tool !== 'hand'} anchor={pop.ref} onClose={pop.close} placement="bottom-center" width={tool === 'eyedropper' ? 360 : ['text', 'select', 'move'].includes(tool) ? 560 : 440} label={tool === 'text' ? 'New text settings' : `${tool} tool settings`} className={`designer-context settings-${tool}`}>
      <ToolSettings {...settings} />
    </Popover>
  </>;
}
