import * as BluebirdPromise from "bluebird";
import {GetOperationStateCommand} from "./GetOperationStateOperation";
import { RequestExecutor, DocumentConventions } from "../..";
import { RavenCommand, IRavenResponse } from "../../Http/RavenCommand";
import { throwError} from "../../Exceptions";
import { OperationExceptionResult } from "./OperationAbstractions";
import { ExceptionDispatcher } from "../../Exceptions";

type OperationStatus = "Completed" | "Cancelled" | "Faulted";

export class OperationCompletionAwaiter {

    private _requestExecutor: RequestExecutor;
    // TBD private readonly Func<IDatabaseChanges> _changes;
    private readonly _conventions: DocumentConventions;
    private readonly _id: number;

    // TBD public Action<IOperationProgress> OnProgressChanged;
    // TBD private IDisposable _subscription;

    public get id(): number {
        return this._id;
    }

    public constructor(requestExecutor: RequestExecutor, conventions: DocumentConventions, id: number) {
        this._requestExecutor = requestExecutor;
        this._conventions = conventions;
        this._id = id;
        // TBD _changes = changes;
    }

    // TBD currently we simply poll for status - implement this using changes API

    private _fetchOperationStatus(): Promise<IRavenResponse> {
        const command: RavenCommand<IRavenResponse> = this._getOperationStateCommand(this._conventions, this._id);
        return Promise.resolve() 
            .then(() => this._requestExecutor.execute(command))
            .then(() => command.result);
    }

    protected _getOperationStateCommand(conventions: DocumentConventions, id: number): RavenCommand<IRavenResponse> {
        return new GetOperationStateCommand(this._conventions, this._id);
    }

    public waitForCompletion(): Promise<void> {
        const operationStatusPolling = () => {
            return BluebirdPromise.resolve()
            .then(() => this._fetchOperationStatus())
            .then((operationStatusResult) => {
                const operationStatus = operationStatusResult.status;
                switch (operationStatus) {
                    case "Completed":
                        return;
                    case "Cancelled":
                        throwError("OperationCancelledException", `Operation of ID ${this._id} has been cancelled.`);
                    case "Faulted":
                        const faultResult: OperationExceptionResult = operationStatusResult.result;
                        const err = ExceptionDispatcher.get(faultResult, faultResult.statusCode);
                        throw err;
                }

                return BluebirdPromise.delay(500)
                    .then(() => operationStatusPolling());
            });
        };

        return Promise.resolve(operationStatusPolling());
    }
}
