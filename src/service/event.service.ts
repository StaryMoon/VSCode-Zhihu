import * as fs from "fs";
import * as path from "path";
import { EventsPath } from "../const/PATH";
import { getExtensionPath } from "../global/globa-var";
import { IColumn } from "../model/publish/column.model";

/**
 * Serializable publish task kinds. Restored tasks dispatch on this value so
 * a scheduled article update can never degrade into a new-article post after
 * a restart.
 */
export type PublishOperation =
    | "postArticle"
    | "updateArticle"
    | "postAnswer"
    | "updateAnswer";

const PUBLISH_OPERATIONS: PublishOperation[] = ["postArticle", "updateArticle", "postAnswer", "updateAnswer"];

export function isPublishOperation(value: unknown): value is PublishOperation {
    return typeof value === "string" && PUBLISH_OPERATIONS.indexOf(value as PublishOperation) >= 0;
}

export interface IEvent {
    /**
     * what to execute when the event is due; persisted, so restarts can
     * recover the exact operation.
     */
    operation: PublishOperation;

    /**
     * target article/answer id for update operations and postAnswer.
     */
    targetId?: string,

    content: string,

    /**
     * md5 hash used to identify the publish event. Includes operation and
     * target id so an update and a post of identical content never collide.
     */
    hash: string,

    /**
     * the publishing time
     */
    date: Date,

    title?: string,

    /**
     * article cover: `null` clears it, `undefined` leaves it untouched.
     */
    titleImage?: string | null,

    /**
     * article column: `null` publishes without a column.
     */
    column?: IColumn | null,

    commentPermission?: string,

    /**
     * used to cancel the event
     */
    timeoutId?: NodeJS.Timeout,

    /**
     * the handler to be executed in the due time. Only valid inside the
     * current session: restored events get a fresh handler rebuilt from
     * `operation` (see PublishService.registerPublishEvents).
     */
    handler?(): void;
}

export class EventService {
    private events: IEvent[];
    constructor () {
        if(fs.existsSync(path.join(getExtensionPath(), EventsPath))) {
            let _events: any[] = JSON.parse(fs.readFileSync(path.join(getExtensionPath(), EventsPath), 'utf8'));
            this.events = _events.map(e => { e.date = new Date(e.date);
                return e});
        } else {
            this.events = [];
        }
    }

    getEvents(): IEvent[] {
        return this.events;
    }

    /**
     * Set events to observed proxy events
     * @param evts the observed proxy evts
     */
    setEvents(evts: IEvent[]) {
        this.events = evts;
    }

    registerEvent(e: IEvent) {
        if (e.handler) {
            e.timeoutId = setTimeout(e.handler, e.date.getTime() - Date.now());
        }
        if(!this.events.find(v => v.hash == e.hash)) {
            this.events.push(e);
            this.persist();
            return true;
        } else return false;
    }

    /**
     * Schedule (or re-schedule) an already stored event, e.g. when a task was
     * restored from disk and needs a timeout rebuilt.
     */
    armEvent(e: IEvent) {
        if (e.timeoutId) {
            clearTimeout(e.timeoutId);
        }
        if (e.handler) {
            e.timeoutId = setTimeout(e.handler, e.date.getTime() - Date.now());
        }
    }

    /**
     * destroy an event. This could be called normally when event occured,
     * but also called intendedly for deletion.
     * @param hash the hash of the event
     */
    destroyEvent(hash: string) {
        // find the target event and destroy its timeout event
        let eventTarget = this.events.find(c => (c.hash == hash))

        // if the timeout handler still registerd, remove it.
        if (eventTarget && eventTarget.timeoutId) clearTimeout(eventTarget.timeoutId);

        // filter the target out
        this.events = this.events.filter(c => !(c.hash == hash));
        this.persist();
    }

    persist() {
        fs.writeFileSync(path.join(getExtensionPath(), EventsPath), JSON.stringify(this.events, (k, v) => {
            if (k == 'timeoutId') return undefined;
            else return v;
        }), 'utf8');
    }

}
