import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { ToolRail } from './ToolRail';
import { ToolSettings } from './ToolSettings';

export function ToolPalette({ history, view, ...settings }: ComponentProps<typeof ToolSettings> & { history: ReactNode; view: ReactNode }) {
  const pop = usePopover();
  const tool = useStore((s) => s.ui.tool);
  const pickedTool = useRef(tool);
  useEffect(() => { if (pickedTool.current !== tool) pop.close(); }, [tool, pop.close]);
  const pick = (button: HTMLButtonElement) => {
    const next = useStore.getState().ui.tool;
    const same = pop.ref.current === button && pickedTool.current === next;
    pickedTool.current = next;
    pop.ref.current = button;
    pop.setOpen(!(same && pop.open));
  };
  return <>
    <div className="designer-palette">
      <ToolRail sessionId={settings.sessionId} doc={settings.doc} onPick={pick} />
    </div>
    <div className="designer-view" role="toolbar" aria-label="Canvas view" aria-orientation="vertical">
      <div className="view-history">{history}</div>
      {view}
    </div>
    <Popover key={tool} open={pop.open && tool !== 'hand'} anchor={pop.ref} onClose={pop.close} placement="bottom-center" width={tool === 'eyedropper' ? 360 : ['text', 'select', 'move'].includes(tool) ? 560 : 440} label={tool === 'text' ? 'New text settings' : `${tool} tool settings`} className={`designer-context settings-${tool}`}>
      <ToolSettings {...settings} />
    </Popover>
  </>;
}
