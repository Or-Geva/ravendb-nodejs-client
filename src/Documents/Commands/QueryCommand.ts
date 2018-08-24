import {HttpRequestParameters} from "../../Primitives/Http";
import { RavenCommand } from "../../Http/RavenCommand";
import { QueryResult } from "../Queries/QueryResult";
import { DocumentConventions } from "../Conventions/DocumentConventions";
import { IndexQuery, writeIndexQuery } from "../Queries/IndexQuery";
import { throwError } from "../../Exceptions";
import { ServerNode } from "../../Http/ServerNode";
import * as StringBuilder from "string-builder";
import { ObjectKeysTransform } from "../../Mapping/ObjectMapper";
import {JsonSerializer } from "../../Mapping/Json/Serializer";
import * as stream from "readable-stream";
import { CollectResultStreamOptions } from "../../Mapping/Json/Streams/CollectResultStream";
import { DocumentsResult } from "./GetDocumentsCommand";
import { RavenCommandResponsePipeline, IRavenCommandResponsePipelineResult } from "../../Http/RavenCommandResponsePipeline";
import { getIgnoreKeyCaseTransformKeysFromDocumentMetadata } from "../../Mapping/Json/Docs";

const QUERY_DOCS_JSON_PATH = [ /^(Results|Includes)$/, { emitPath: true } ];

export class QueryCommand extends RavenCommand<QueryResult> {

    private _conventions: DocumentConventions;
    private _indexQuery: IndexQuery;
    private _metadataOnly: boolean;
    private _indexEntriesOnly: boolean;

    public constructor(
        conventions: DocumentConventions, indexQuery: IndexQuery, metadataOnly: boolean, indexEntriesOnly: boolean) {
        super();

        this._conventions = conventions;

        if (!indexQuery) {
            throwError("InvalidArgumentException", "indexQuery cannot be null.");
        }

        this._indexQuery = indexQuery;
        this._metadataOnly = metadataOnly;
        this._indexEntriesOnly = indexEntriesOnly;
    }

    public createRequest(node: ServerNode): HttpRequestParameters {
        this._canCache = !this._indexQuery.disableCaching;

        // we won't allow aggressive caching of queries with WaitForNonStaleResults
        this._canCacheAggressively = this._canCache && !this._indexQuery.waitForNonStaleResults;

        const path = new StringBuilder(node.url)
                .append("/databases/")
                .append(node.database)
                .append("/queries?queryHash=")
                // we need to add a query hash because we are using POST queries
                // so we need to unique parameter per query so the query cache will
                // work properly
                .append(this._indexQuery.getQueryHash());

        if (this._metadataOnly) {
            path.append("&metadataOnly=true");
        }

        if (this._indexEntriesOnly) {
            path.append("&debug=entries");
        }

        const uri = path.toString();
        const body = writeIndexQuery(this._conventions, this._indexQuery);
        const headers = this._getHeaders().withContentTypeJson().build();
        return {
            method: "POST",
            uri,
            headers,
            body
        };
    }

    protected get _serializer(): JsonSerializer {
        const serializer = super._serializer;
        return serializer;
    }

    public setResponse(response: string, fromCache: boolean): void {
        if (!response) {
            this.result = null;
            return;
        }

        const rawResult = ObjectKeysTransform.camelCase(
            JsonSerializer.getDefault().deserialize(response), false);
        this.result = this._typedObjectMapper.fromObjectLiteral(rawResult, {
            typeName: QueryResult.name
        }, new Map([[QueryResult.name, QueryResult]]));

    }

    public async setResponseAsync(bodyStream: stream.Stream, fromCache: boolean): Promise<string> {
        if (!bodyStream) {
            this.result = null;
            return;
        }
        
        const collectResultOpts: CollectResultStreamOptions<DocumentsResult> = {
            reduceResults: (result: DocumentsResult, chunk: { path: string | any[], value: object }) => {
                const doc = chunk.value;
                const path = chunk.path;

                if (!doc["@metadata"]) {
                    throw new Error("Document must have @metadata.");
                }

                if (path[0] === "Results") {
                    result.results.push(doc);
                } else if (path[0] === "Includes") {
                    if (!doc["@metadata"]["@id"]) {
                        throw new Error("Document must have @id in @metadata.");
                    }

                    result.includes[doc["@metadata"]["@id"]] = doc;
                }

                return result;
            },
            initResult: { results: [], includes: {} } as DocumentsResult
        };

        return RavenCommandResponsePipeline.create()
            .collectBody()
            .parseJsonAsync(QUERY_DOCS_JSON_PATH)
            .streamKeyCaseTransform({
                targetKeyCaseConvention: this._conventions.entityFieldNameConvention,
                extractIgnorePaths: (e) => [ 
                    ...getIgnoreKeyCaseTransformKeysFromDocumentMetadata(e), 
                    /@metadata\./ 
                ],
                ignoreKeys: [ /^@/ ]
            })
            .restKeyCaseTransform({ targetKeyCaseConvention: "camel" })
            .collectResult(collectResultOpts)
            .process(bodyStream)
            .then((result: IRavenCommandResponsePipelineResult<DocumentsResult>) => {
                const rawResult = Object.assign(result.result, result.rest) as QueryResult;
                this.result = this._reviveResultTypes(rawResult, {
                    typeName: QueryResult.name
                }, new Map([[QueryResult.name, QueryResult]]));

                if (fromCache) {
                    this.result.durationInMs = -1;
                }
                
                return result.body;
            });
    }

    public get isReadRequest(): boolean {
        return true;
    }
}