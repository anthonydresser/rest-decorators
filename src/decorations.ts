const addressMetadataKey = Symbol("address");
// Parameter decorator that is used to inject the address from the request
export function address(
    target: Object,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Reflect.defineMetadata(
        addressMetadataKey,
        parameterIndex,
        target,
        propertyKey
    );
}

type Methods = "get" | "post" | "delete";

interface ResponderDefinition {
    readonly key: string;
    readonly path: string | RegExp;
    readonly method: Methods;
}

const pathMetadataKey = Symbol("path");
// Parameter decorator that defined the path for the get method
export function GET(path: string | RegExp) {
    return function (
        target: Object,
        propertyKey: string,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>
    ) {
        const existingPaths: Array<ResponderDefinition> =
            Reflect.getMetadata(pathMetadataKey, target) || [];

        existingPaths.push({
            key: propertyKey,
            path,
            method: "get",
        });
        Reflect.defineMetadata(pathMetadataKey, existingPaths, target);
    };
}

// Parameter decorator that defined the path for the post method
export function POST(path: string | RegExp) {
    return function (
        target: Object,
        propertyKey: string,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>
    ) {
        const existingPaths: Array<ResponderDefinition> =
            Reflect.getMetadata(pathMetadataKey, target) || [];

        existingPaths.push({
            key: propertyKey,
            path,
            method: "post",
        });
        Reflect.defineMetadata(pathMetadataKey, existingPaths, target);
    };
}

// Parameter decorator that defined the path for the delete method
export function DELETE(path: string | RegExp) {
    return function (
        target: Object,
        propertyKey: string,
        descriptor: TypedPropertyDescriptor<(...args: any[]) => any>
    ) {
        const existingPaths: Array<ResponderDefinition> =
            Reflect.getMetadata(pathMetadataKey, target) || [];

        existingPaths.push({
            key: propertyKey,
            path,
            method: "delete",
        });
        Reflect.defineMetadata(pathMetadataKey, existingPaths, target);
    };
}

const protectMetadataKey = Symbol("protect");
// Method decorator that is used to protect the method which requires the caller to be authenticated
export function protect(
    target: Object,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: any[]) => any>
) {
    Reflect.defineMetadata(protectMetadataKey, true, target, propertyKey);
}

// maps paramater indexes to capture group indexes
interface CaptureGrouping {
    readonly index: number;
    readonly required: boolean;
}
type CaptureGroupings = Array<CaptureGrouping | undefined>;

const captureMetadataKey = Symbol("capture");
// Parameter decorator that is used to capture a parameter from the path
export function capture(index: number, required: boolean = false) {
    return function (
        target: Object,
        propertyKey: string | symbol,
        parameterIndex: number
    ) {
        const existingCaptures: CaptureGroupings =
            Reflect.getMetadata(captureMetadataKey, target, propertyKey) || [];
        existingCaptures[parameterIndex] = { index, required };
        Reflect.defineMetadata(
            captureMetadataKey,
            existingCaptures,
            target,
            propertyKey
        );
    };
}

const bodyMetadataKey = Symbol("body");
// Parameter decorator that is used to inject the body from the request
export function body(
    target: Object,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Reflect.defineMetadata(
        bodyMetadataKey,
        parameterIndex,
        target,
        propertyKey
    );
}

interface ResponderConstructor<TInjections> {
    new (...args: TInjections[]): any;
}

export interface Responses<TResponse> {
    readonly 400: TResponse;
    readonly 401: TResponse;
}

export class Responders<TInjections, TResponse> {
    private readonly responderEntries: Array<Responder<TResponse>> = [];
    private readonly responderConstructors: Array<ResponderConstructor<TInjections>> = [];

    constructor(private readonly responses: Responses<TResponse>) { }

    get(path: string, method: string): Responder<TResponse> | undefined {
        return this.responderEntries.find((r) => r.match(path, method));
    }

    init(injections: { readonly key: Symbol, readonly value: any }[]) {
        this.responderConstructors.forEach((r) => {
            const args: any[] = [];
            injections.forEach(v => {
                if (Reflect.getMetadata(v.key, r) !== undefined) {
                    args[Reflect.getMetadata(v.key, r)] = v.value;
                }
            });
            const responder = new r(...args)
            const paths: Array<ResponderDefinition> = Reflect.getMetadata(
                pathMetadataKey,
                responder
            );
    
            this.responderEntries.push(
                ...paths.map((p) => new Responder<TResponse>(responder, p.path, p.method, p.key, this.responses))
            );
        });
    }

    register(responder: ResponderConstructor<TInjections>) {
        this.responderConstructors.push(responder);
    }
}

class Responder<TResponse> {
    constructor(
        private readonly responder: any,
        private readonly path: string | RegExp,
        private readonly method: Methods,
        private readonly key: string,
        private readonly responses: Responses<TResponse>
    ) { }

    public match(path: string, method: string): boolean {
        return (
            method === this.method &&
            (this.path instanceof RegExp ? this.path.test(path) : this.path === path)
        );
    }

    public async call(
        path: string,
        address?: string,
        body?: string,
    ): Promise<TResponse> {
        if (
            Reflect.getMetadata(protectMetadataKey, this.responder, this.key) &&
            !address
        ) {
            return this.responses[401];
        }
        const addressArgIndex = Reflect.getMetadata(
            addressMetadataKey,
            this.responder,
            this.key
        );
        const args: any[] = [];
        if (addressArgIndex !== undefined) {
            args[addressArgIndex] = address;
        }
        const bodyArgIndex = Reflect.getMetadata(
            bodyMetadataKey,
            this.responder,
            this.key
        );
        if (bodyArgIndex !== undefined) {
            args[bodyArgIndex] = body;
        }
        if (this.path instanceof RegExp) {
            const captureGroupings: CaptureGroupings = Reflect.getMetadata(
                captureMetadataKey,
                this.responder,
                this.key
            );
            if (captureGroupings) {
                const matches = this.path.exec(path);
                for (const index in captureGroupings) {
                    const grouping = captureGroupings[index];
                    if (grouping) {
                        if (grouping.required && !matches![grouping.index]) {
                            return this.responses[400];
                        } else {
                            args[index] = matches![grouping.index];
                        }
                    }
                }
            }
        }
        return this.responder[this.key](...args);
    }
}
