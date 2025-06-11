export namespace main {
	
	export class BackendResponse {
	    success: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new BackendResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.message = source["message"];
	    }
	}

}

