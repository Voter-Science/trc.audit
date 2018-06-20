// Sample 'Hello World' Plugin template.
// Demonstrates:
// - typescript
// - using trc npm modules and browserify
// - uses promises. 
// - basic scaffolding for error reporting. 
// This calls TRC APIs and binds to specific HTML elements from the page.  

import * as XC from 'trc-httpshim/xclient'
import * as common from 'trc-httpshim/common'

import * as core from 'trc-core/core'

import * as trcSheet from 'trc-sheet/sheet'
import * as trcSheetEx from 'trc-sheet/sheetEx'

import * as plugin from 'trc-web/plugin'
import * as trchtml from 'trc-web/html'

import * as bcl from 'trc-analyze/collections'
import * as analyze from 'trc-analyze/core'

import * as _mode from './mode'

// Installed via:
//   npm install --save-dev @types/jquery
// requires tsconfig: "allowSyntheticDefaultImports" : true 
declare var $: JQueryStatic;

// Provide easy error handle for reporting errors from promises.  Usage:
//   p.catch(showError);
declare var showError: (error: any) => void; // error handler defined in index.html

export class MyPlugin {
    private _sheet: trcSheet.SheetClient;
    private _pluginClient: plugin.PluginClient;

    public static BrowserEntryAsync(
        auth: plugin.IStart,
        opts: plugin.IPluginOptions
    ): Promise<MyPlugin> {

        var pluginClient = new plugin.PluginClient(auth, opts);

        // Do any IO here...

        var throwError = false; // $$$ remove this

        var plugin2 = new MyPlugin(pluginClient);
        return plugin2.InitAsync().then(() => {
            if (throwError) {
                throw "some error";
            }

            return plugin2;
        });
    }

    // Expose constructor directly for tests. They can pass in mock versions. 
    public constructor(p: plugin.PluginClient) {
        this._sheet = new trcSheet.SheetClient(p.HttpClient, p.SheetId);
    }


    // Make initial network calls to setup the plugin. 
    // Need this as a separate call from the ctor since ctors aren't async. 
    private InitAsync(): Promise<void> {
        return this._sheet.getInfoAsync().then(info => {

            $("#SheetName").text(info.Name);
            $("#ParentSheetName").text(info.ParentName);
            $("#SheetVer").text(info.LatestVersion);
            $("#RowCount").text(info.CountRecords);

            $("#LastRefreshed").text(new Date().toLocaleString());


            var a = new analyze.AnalyzeClient(this._sheet);
            a.setProgressCallback((msg: string) =>
                $("#status").text(msg)
            );
            this._analyze = a;

            // this will force a cache 
            return a.getAllChangesAsync().then(changelist => {
                this._ctx = new _mode.RenderContext();
                this._ctx.changelist = changelist;
                var e = $("#contents");
                this._ctx.element = e;

                window.onhashchange = (ev: HashChangeEvent) => {
                    this.showCurrentHash();
                };

                //var mode = new _mode.ShowDeltaRange(changelist);
                //this.show(mode)                
                this.showCurrentHash();
            });
        });
    }

    // Called by onhashchange
    // This does _not_ set hash, since that would retrigger the onhashchange and cause a loop.
    private showCurrentHash() {
        var hash = window.location.hash; // Escaped value, starts with '#'
        if (!hash || hash.length < 2) 
        {
            // Blank .. set to something.
            // This will trigger an on-change event. 
            window.location.hash = "show=daily";
            return;
        }
        var x = decodeURIComponent(hash.substr(1));

        // alert("Update:" + x);

        try {
            var m = _mode.Mode.parse(x);
            this.showInternal(m);
        }
        catch (e) {
            showError(e);
        }
    }


    private show(mode: _mode.Mode) {
        // https://gist.github.com/LoonyPandora/5157532

        // Setting the hash will also cooperate with forward and backward buttons 
        // https://blog.httpwatch.com/2011/03/01/6-things-you-should-know-about-fragment-urls/

        // This will trigger the onhashchange event, although it may fire deferred 
        window.location.hash = mode.toHash();

        // this.showInternal(mode);
    }

    private showInternal(mode: _mode.Mode) {


        // Parse the msg
        // var m =_mode.Mode.parse("");

        var hash = mode.toHash();
        $("#queryx").text(hash);

        var descr = mode.getDescription();
        $("#descr").text(descr);

        var map = $("#map");
        map.empty();
        $("#map").hide();

        this._ctx.element.empty();
        this._ctx.Next = (x) => this.show(x);

        mode.render(this._ctx);
    }

    private _ctx: _mode.RenderContext;
    private _analyze: analyze.AnalyzeClient;
}
