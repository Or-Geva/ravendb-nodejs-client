import { testContext, disposeTestDocumentStore } from "../Utils/TestUtil";

import {
    IDocumentSession,
    IDocumentStore,
} from "../../src";
import * as assert from "assert";
import * as stream from "readable-stream";
import { getStringWritable } from "../Utils/Streams";
import { parseJsonVerbose } from "../Utils/Json";
import * as StreamUtil from "../../src/Utility/StreamUtil";

class Employee {
    public firstName: string;
}

describe.skip("load into stream", function () {

    let store: IDocumentStore;

    beforeEach(async function () {
        store = await testContext.getDocumentStore();
    });

    afterEach(async () =>
        await disposeTestDocumentStore(store));

    it("can load by ids into stream ", async () => {
        await insertData();

        {
            const session = store.openSession();

            const ids = ["employees/1-A", "employees/4-A", "employees/7-A"];

            const targetStream = getStringWritable();
            let result;
            targetStream.once("content", _ => result = _);

            await session.advanced.loadIntoStream(ids, targetStream);

            const jsonNode = parseJsonVerbose(result);
            const res = jsonNode.results;
            assert.strictEqual(res.length, 3);

            const names = new Set(["Aviv", "Maxim", "Michael"]);
            for (const v of res) {
                assert.ok(names.has(v.firstName));
            }
        }
    });

    it("can load starting with into stream", async () => {
        await insertData();

        {
            const session = store.openSession();
            const targetStream = getStringWritable();
            let result;
            targetStream.once("content", _ => result = _);
            await session.advanced.loadStartingWithIntoStream("employees/", targetStream);

            const jsonNode = parseJsonVerbose(result);
            const res = jsonNode.results;
            assert.strictEqual(res.length, 7);

            const names = new Set(["Aviv", "Iftah", "Tal", "Maxim", "Karmel", "Grisha", "Michael"]);

            for (const v of res) {
                assert.ok(names.has(v.firstName));
            }
        }
    });

    const insertData = async () => {
        const session = store.openSession();
        const insertEmployee = (name: string) => {
            const employee = new Employee();
            employee.firstName = name;
            return session.store(employee);
        };

        await insertEmployee("Aviv");
        await insertEmployee("Iftah");
        await insertEmployee("Tal");
        await insertEmployee("Maxim");
        await insertEmployee("Karmel");
        await insertEmployee("Grisha");
        await insertEmployee("Michael");
        await session.saveChanges();
    };

});