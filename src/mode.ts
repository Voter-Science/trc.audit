import * as core from 'trc-core/core'
import * as trcSheet from 'trc-sheet/sheet'
import { SheetContentsIndex, SheetContents, ISheetContents } from 'trc-sheet/sheetContents';
import * as bcl from 'trc-analyze/collections'
import * as analyze from 'trc-analyze/core'
import * as trchtml from 'trc-web/html'

// Used for rending onto screen
declare var $: JQueryStatic;

// Different lists 

//  key=value;key=value;key=value

// Standard Changelist filters:
//     Version=45;VersionEnd=47;
//     Day=xxxxx
//     User=bob@contoso.com;
//     TimeStart=xxxx;TimeEnd=yyyyy
//     App=xxxxxxx

// Show an exact delta 
//   Show=Delta;Version=45
//
// Delta list. Optional filters. 
//   Show=DeltaList;
//      [ChangelistFilters]
//
// Session List. These are the clusters 
//   Show=Sessions
//      [ChangelistFilters]
//
// Daily Report:  Group clusters by day . data[User][Day] = # of active mintues.
//   Show=UsersDaily


// convert a date into a sortable integer. 
// YYYYMMDD
function sortableDay(x: Date): number {
    var year: number = x.getFullYear();     // 4 digit year 
    var month: number = 1 + x.getMonth(); // months are 0-based
    var day: number = x.getDate();  // days are 1-based 
    return year * 10000 + month * 100 + day;
}

function addNormalizedDay(x: ISheetContents, columnName: string, newColumnName: string): void {
    var col = x[columnName];

    var days: string[] = [];
    x[newColumnName] = days;

    for (var i in col) {
        var val = col[i];
        var d = new Date(val);

        var trStart = bcl.TimeRange.roundToDay(d);
        days.push(sortableDay(trStart).toString());
    }
}

export class Context
{
    public changelist : analyze.Changelist;
    public element : JQuery<HTMLElement>;

    // used by click handlers 
    public Next : (mode : Mode) => void; 
}

// Generate a clickable node that will take us to another view
function clickable(ctx : Context, text : string, next : () => Mode) : JQuery<HTMLElement> {
    var td1 = $("<button>").text(text).click( () => {
        var x = next();
        ctx.Next(x);
    });
    return td1;
}

export abstract class Mode
{
    
    static parse(value : string) : Mode {
        return new ShowDelta(1);
    }

    public abstract render(ctx : Context) : void;

    public abstract toHash() : string;
}


// Shows a single delta at an exact version
export class ShowDelta extends Mode 
{
    private _ver : number;

    public constructor(ver : number) 
    {
        super();
        this._ver = ver;        
    }

    public render(ctx : Context) : void {
        var delta : trcSheet.IDeltaInfo = ctx.changelist.get(this._ver); 

        var json = JSON.stringify(delta, null, 2);

        var e = $("<pre>").text(json);
        ctx.element.append(e);
    }

    public toHash() : string {
        return "ver=" + this._ver;
    }
}


// Shows a range of deltas 
// Clicks:
//   - on ver# --> ShowDelta(version)
export class ShowDeltaRange extends Mode 
{
    private _cl : analyze.Changelist; // already has filter applied!

    public constructor(changelist : analyze.Changelist) 
    {
        super();
        this._cl = changelist;        
    }

    public toHash() : string {
        // $$$
        return "ver_range=" + this._cl.toString();
    } 


    public render(ctx : Context) : void {
        
        var e1 = $("<table>");
        
        var tr = $("<tr>");
        var td1 = $("<td>").text("Version");
        var td2 = $("<td>").text("User");
        var td3 = $("<td>").text("UtcTime");
        tr.append(td1).append(td2).append(td3);
        e1.append(tr);

        this._cl.forEach( (delta : trcSheet.IDeltaInfo) => {

            var tr = $("<tr>");
            td1 = $("<td>").append(
                clickable(ctx,
                     delta.Version.toString(),
                 () => new ShowDelta(delta.Version)));

            var td2 = $("<td>").text(delta.User);
            var td3 = $("<td>").text(delta.Timestamp);
            tr.append(td1).append(td2).append(td3);
            e1.append(tr);
        });

        ctx.element.append(e1);        
    }
}

/*
// Shows a single delta 
export class ShowAllVers extends Mode 
{
    public render(ctx : Context) : void {
        // Apply filters 
        var sc = ctx.changelist.normalizeByVer();


        addNormalizedDay(sc, "Timestamp", "DayNumber");

        var r = new trchtml.RenderSheet("contents", sc);
        r.render();
    }
}

export class FlattenToRecId extends Mode 
{
    public render(ctx : Context) : void {
        // Apply filters 
        var sc = ctx.changelist.flattenByRecId();

        var r = new trchtml.RenderSheet("contents", sc);
        r.render();
    }
}*/