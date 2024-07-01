import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from '@girs/gnome-shell/ui/main';

//  TODO: get this var from gschema
const DEBUG_MODE = false as const;

type DummyActor = {
  workspaceIndex: number;
  actor: St.Widget;
};

export default class SeparateMonitorFocus extends Extension {
  private _dummyActors: { [key: number]: DummyActor } = {};
  private _signals: number[] = [];

  _debug(...data: any[]): void {
    if (DEBUG_MODE) {
      console.log('Separate Monitor Focus Debug: ', ...data);
    }
  }

  private _cleanDummyActorOnWindowCreated(window: Meta.Window): void {
    const currentMonitor: number = global.display.get_current_monitor();
    const activeWorkspace: Meta.Workspace = global.workspace_manager.get_active_workspace();
    const windowWorkspace: Meta.Workspace = window.get_workspace();
    this._debug('window created');

    if (window.get_monitor() === currentMonitor && windowWorkspace === activeWorkspace) {
      this._debug('cleaning in window-created');
      this._cleanupDummyActor(windowWorkspace.index());
    }
  }

  private _checkWorkspaceHasWindowOpened(workspace: Meta.Workspace): void {
    const currentMonitor: number = global.display.get_current_monitor();
    const windowsOnCurrentMonitor: Array<Meta.Window> = workspace.list_windows().filter((win) => {
      return win.get_monitor() === currentMonitor;
    });

    const windowsOnMonitors: Array<Meta.Window> = workspace.list_windows().filter((win) => {
      return win.get_monitor() !== currentMonitor;
    });

    if (windowsOnCurrentMonitor.length <= 0 && (DEBUG_MODE || windowsOnMonitors.length > 0)) {
      const workspaceId: number = workspace.index();
      this._onWindowClosed(workspaceId);
    } else if (windowsOnCurrentMonitor.length > 0) {
      //  NOTE: would be nice to focus on the top window showing in the workspace.
      windowsOnCurrentMonitor.some((window) => {
        if (!window.minimized) {
          this._debug('window title', window.title);
          window.focus(workspace.index());
          return !window.minimized;
        }
      });
    }
  }

  private _focusWorkspace(workspaceManager: Meta.WorkspaceManager): void {
    this._signals.push(
      workspaceManager.get_active_workspace().connect('window-removed', (workspace, _window) => {
        this._checkWorkspaceHasWindowOpened(workspace);
      }),
    );
  }

  private _onWindowClosed(workspaceId: number): void {
    this._debug('No windows on primary monitor in active workspace, creating dummy actor', workspaceId);
    this._cleanupDummyActor(workspaceId);
    const dummyActor: DummyActor = { actor: new St.Widget(), workspaceIndex: workspaceId };
    const backgroundColor: Clutter.Color = Main.panel.get_background_color();

    dummyActor.actor.set_position(100, 100);
    dummyActor.actor.set_size(100, 100);
    dummyActor.actor.set_background_color(DEBUG_MODE ? Clutter.color_from_string('#ff5555')[1] : backgroundColor);
    dummyActor.actor.set_can_focus(true);
    dummyActor.actor.show();
    dummyActor.actor.grab_key_focus();
    this._dummyActors[workspaceId] = dummyActor;

    Main.layoutManager.addChrome(this._dummyActors[workspaceId].actor);
    global.stage.get_stage().set_key_focus(this._dummyActors[workspaceId].actor);
  }

  private _cleanupDummyActor(workspaceId: number): void {
    if (this._dummyActors[workspaceId]) {
      this._debug('Removing dummy actor from workspaceId', workspaceId);
      Main.layoutManager.removeChrome(this._dummyActors[workspaceId].actor);
      this._dummyActors[workspaceId].actor.destroy();
      delete this._dummyActors[workspaceId];
    }
  }

  public enable() {
    this._debug('ENABLED');
    this._focusWorkspace(global.workspace_manager);
    this._signals.push(
      global.workspace_manager.connect('active-workspace-changed', (_source) => {
        this._debug('active-workspace-changed');
        this._focusWorkspace(_source);
        //  NOTE: on enter a workspace, if there's no window,
        // focus will change to the 2° screen.
        this._checkWorkspaceHasWindowOpened(_source.get_active_workspace());
      }),
    );

    this._signals.push(
      global.workspace_manager.connect('workspace-switched', (_source, _object, _p0, p1) => {
        console.log('workspace-switched');
        const indexToClean: number = _source.get_active_workspace_index() + (p1 === Meta.MotionDirection.RIGHT ? -1 : 1);
        this._cleanupDummyActor(indexToClean);
      }),
    );

    this._signals.push(
      global.display.connect('window-entered-monitor', (_, __, window) => {
        this._cleanDummyActorOnWindowCreated(window);
      }),
      global.display.connect('window-created', (_, window) => {
        this._cleanDummyActorOnWindowCreated(window);
      }),
    );
  }

  public disable() {
    //  TODO: disconnet for display signals
    this._signals.forEach((signal) => {
      global.workspace_manager.disconnect(signal);
    });
    Object.keys(this._dummyActors).forEach((workspaceId) => {
      this._cleanupDummyActor(parseInt(workspaceId));
    });
    this._signals = [];
    this._debug('DISABLED');
  }
}
