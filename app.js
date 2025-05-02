import { app, query, errorHandler, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { isAdminUser } from './lib/authorization';
import queryAnswerAsCsv, { bindingsAndHeadersAsCsv } from './lib/query-answer-as-csv';
import joinResults from './lib/join-results';

function reqDates(req) {
  return {
    from: req.query.from && new Date(req.query.from),
    to: req.query.to && new Date(req.query.to)
  }
}

const BASKET_STATUS_MAPPING = {
  draft: "http://veeakker.be/order-statuses/draft",
  confirmed: "http://veeakker.be/order-statuses/confirmed"
};

app.get('/changed', async function( req, res ) {
  // Yields the baskets which have changed status
  if( await isAdminUser( req ) ) {
    try {
      const { from, to } = reqDates( req );
      // TODO: accept various ways of supplying delivery information
      const response = await basketsWithStatus({
        from, to, status: null
      });

      res
        .status(200)
        .send( queryAnswerAsCsv(response) );
    } catch (e) {
      console.log(e);
    }
  } else {
    res.status(403).send(JSON.stringify({errors: [{code: "403", message: "Forbidden, not administrator"}]}));
  }
});

async function basketsWithStatus( { status, from, to } ) {
  try {
    return await query(`
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      SELECT DISTINCT ?graph ?basket (?date AS ?lastChange) ?status
      WHERE {
        GRAPH ?graph {
          ${ status ? `VALUES ?status { ${sparqlEscapeUri( status )} }` : "" }
          ?basket
            a veeakker:Basket;
            veeakker:statusChangedAt ?date;
            veeakker:basketOrderStatus ?status.
          ${ from ? `FILTER( ?date >= ${sparqlEscapeDateTime(from)} )` : "" }
          ${ to ? `FILTER( ?date <= ${sparqlEscapeDateTime(to) })` : "" }
        }
      } ORDER BY DESC(?date)`,
      { sudo: true });
  } catch (e) {
      console.log(e);
  }
}

/**
 * Returns the delivery information for the given basket.
 */
async function basketDeliveryInfo( basket, graph ) {
  const selectedDeliveryPlaceAnswer = (await query(`
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT DISTINCT ?deliveryType ?deliveryPlaceUri ?deliveryPlace ?routeUri ?route WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        VALUES ?basket { ${sparqlEscapeUri( basket )} }
        ?basket a veeakker:Basket.
        OPTIONAL { ?basket veeakker:deliveryType ?deliveryType. }
        }
      OPTIONAL {
        GRAPH ${sparqlEscapeUri(graph)} {
          ?basket a veeakker:Basket.
          ?basket veeakker:deliveryPlace ?deliveryPlaceUri.
        }
        GRAPH <http://mu.semte.ch/graphs/public> {
          ?deliveryPlaceUri dct:title ?deliveryPlace.
          OPTIONAL {
            ?deliveryPlaceUri
              veeakker:belongsToRoute ?routeUri;
              dct:title ?route.
          }
        }
      }
    }
  `, { sudo: true })).results.bindings;

  // custom delivery place // TODO: this probably belongs elsewhere
  const customDeliveryAddressAnswer = (await query(`
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX schema: <http://schema.org/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX gr: <http://purl.org/goodrelations/v1#>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT DISTINCT
      (CONCAT(?firstName, " ", ?lastName) AS ?name)
      ?deliveryAddress
      ?phone
      ?email
      ?streetAddress
      ?postalCode
      ?locality
      ?user
      ?companyInfo
      ?hasCustomDeliveryPlace
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        VALUES ?basket { ${sparqlEscapeUri( basket )} }
        ?basket veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace.
        ?basket veeakker:deliveryAddress ?deliveryAddress.
        ?deliveryAddress
          schema:email ?email;
          foaf:firstName ?firstName;
          foaf:lastName ?lastName;
          foaf:phone ?phone.
        ?deliveryAddress schema:hasAddress ?address.

        ?address
          schema:addressLocality ?locality;
          schema:postalCode ?postalCode;
          schema:streetAddress ?streetAddress.

        OPTIONAL {
          ?deliveryAddress ext:companyInfo ?companyInfo.
        }
      }
      FILTER (?hasCustomDeliveryPlace)
    }
  `, { sudo: true })).results.bindings;

  return { customDeliveryAddressAnswer, selectedDeliveryPlaceAnswer };
}

async function basketUserInfo( basket, graph ) {
  // TODO: should we split up the user info from the delivery info?  That might make reading in the data more obvious
  // towards import too because we could register a standard place for order separately from the how the specific order
  // was made.  This may give us liberty in how to support users in the future (automatically selecting, asking, ...).
  // These two data points seem to differ regardles.

  // If a basket was orderedBy a foaf:Person, then we should consider the person's address.  Otherwise we should
  // consider the invoiceAddress as the address for the user who ordered the basket.

  // Delivery place may also be hasCustomDeliveryPlace in which case the delivery place should override the address.  We
  // can fetch both in this case and select the custom delivery place in cases where that wins.

  // 1. logged in user info
  const loggedInUserAnswer = (await query(`
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX schema: <http://schema.org/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX gr: <http://purl.org/goodrelations/v1#>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT DISTINCT
      (CONCAT(?firstName, " ", ?lastName) AS ?name)
      ?address
      ?phone
      ?email
      ?streetAddress
      ?postalCode
      ?locality
      ?user
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        VALUES ?basket { ${sparqlEscapeUri( basket )} }
        ?user veeakker:hasBasket ?basket.
        ?user
          (foaf:email | schema:email) ?email; # TODO: convert to schema
          foaf:firstName ?firstName;
          foaf:lastName ?lastName;
          foaf:phone ?phone.
        ?user schema:postalAddress ?address.
        ?address
          schema:addressLocality ?locality;
          schema:postalCode ?postalCode;
          schema:streetAddress ?streetAddress.
        }
      }
   `, { sudo: true })).results.bindings

  if( loggedInUserAnswer.length > 1 ) {
    console.warn(`Found more than one user info result for basket ${basket} and graph ${graph}, using first result.`);
  }

  // 2. guest user info
  const invoiceAddressAnswer = (await query(`
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX schema: <http://schema.org/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX gr: <http://purl.org/goodrelations/v1#>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT DISTINCT
      (CONCAT(?firstName, " ", ?lastName) AS ?name)
      ?userAddress
      ?phone
      ?email
      ?streetAddress
      ?postalCode
      ?locality
      ?companyInfo
    WHERE {
      GRAPH ${sparqlEscapeUri(graph)} {
        VALUES ?basket { ${sparqlEscapeUri( basket )} }
        ?basket veeakker:invoiceAddress ?userAddress.
        ?userAddress
          schema:email ?email;
          foaf:firstName ?firstName;
          foaf:lastName ?lastName;
          foaf:phone ?phone.
        ?userAddress schema:hasAddress ?address.
        ?address
          schema:addressLocality ?locality;
          schema:postalCode ?postalCode;
          schema:streetAddress ?streetAddress.
        OPTIONAL {
          ?userAddress ext:companyInfo ?companyInfo.
        }
      }
      FILTER NOT EXISTS { ?user veeakker:hasBasket ?basket; a foaf:Person. }
    }
  `, { sudo: true })).results.bindings;

  // 3. combine the results
  return {
    loggedInUserAnswer, invoiceAddressAnswer
  }
}

async function basketOrderLines( basket, graph ) {
  const response = await query(`
    PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX schema: <http://schema.org/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX gr: <http://purl.org/goodrelations/v1#>
    PREFIX adms: <http://www.w3.org/ns/adms#>

    SELECT DISTINCT
      ?plu
      ?aantalPakjes
      ?totalPrice
      (?pStuks AS ?besteldStuks)
      (?pGrm AS ?besteldGram)
      ?basket
      ?comment
      ?orderLine
    WHERE {
      VALUES ?basket { ${sparqlEscapeUri(basket)} }
      GRAPH ${sparqlEscapeUri(graph)} {
        ?basket veeakker:orderLine ?orderLine.
        ?orderLine veeakker:amount ?aantalPakjes.
        ?orderLine veeakker:hasOffering ?offering.
        OPTIONAL { ?orderLine veeakker:customerComment ?comment }
      }
      GRAPH <http://mu.semte.ch/graphs/public> {
        ?offering gr:hasPriceSpecification ?priceSpecification.
        ?offering gr:includesObject ?typeAndQuantity.
        ?priceSpecification gr:hasCurrencyValue ?totalPrice.
        ?typeAndQuantity gr:typeOfGood ?product.
        OPTIONAL { ?product veeakker:plu ?plu. }

        OPTIONAL {
          ?typeAndQuantity
          gr:hasUnitOfMeasurement "KGM";
          gr:amountOfThisGood ?pKg.
          BIND ( ?pKg * 1000 AS ?pGrm )
        }
        OPTIONAL {
          ?typeAndQuantity
          gr:hasUnitOfMeasurement "C62";
          gr:amountOfThisGood ?pStuks.
        }
        OPTIONAL {
          ?typeAndQuantity
          gr:hasUnitOfMeasurement "GRM";
          gr:amountOfThisGood ?pGrm.
        }
      }
    }
  `, { sudo: true });

  return response.results.bindings;
}

app.get('/baskets', async function( req, res ) {
  if( await isAdminUser(req) ) {
    try {
      const { from, to } = reqDates( req );
      const basketStatus = req.query.status
        ? BASKET_STATUS_MAPPING[req.query.status]
        : BASKET_STATUS_MAPPING["confirmed"];

      const basketsResponse = await basketsWithStatus( { from, to, status: basketStatus } );
      const allOrderLines = [];

      for ( let basketInfo of basketsResponse.results.bindings ) {
        // each basket
        let infoToCombine = [[basketInfo]];
        // find the user's information
        let userInfo = await basketUserInfo( basketInfo.basket.value, basketInfo.graph.value );
        // find delivery information
        let deliveryInfo = await basketDeliveryInfo( basketInfo.basket.value, basketInfo.graph.value );
        // collect orderlines
        let orderLines = await basketOrderLines( basketInfo.basket.value, basketInfo.graph.value );

        if ( userInfo.loggedInUserAnswer.length )
          infoToCombine.push(userInfo.loggedInUserAnswer)
        if ( userInfo.loggedInUserAnswer.length > 1 )
          console.warn("Got more than one user for ${basketInfo.basket.value} ${basketInfo.graph.value}");

        if ( userInfo.invoiceAddressAnswer.length )
          // last one wins (vs logged in user info or custom delivery address)
          infoToCombine.push(userInfo.invoiceAddressAnswer)
        if ( userInfo.invoiceAddressAnswer.length > 1 )
          console.warn("Got more than one invoice address for ${basketInfo.basket.value} ${basketInfo.graph.value}");
        
        if ( deliveryInfo.customDeliveryAddressAnswer.length )
          infoToCombine.push(deliveryInfo.customDeliveryAddressAnswer)
        if ( deliveryInfo.customDeliveryAddressAnswer.length > 1 )
          console.warn("Got more than one delivery info for ${basketInfo.basket.value} ${basketInfo.graph.value}");

        if ( deliveryInfo.selectedDeliveryPlaceAnswer.length )
          infoToCombine.push(deliveryInfo.selectedDeliveryPlaceAnswer)
        if ( deliveryInfo.selectedDeliveryPlaceAnswer.length > 1 )
          console.warn("Got more than one selected delivery address for ${basketInfo.basket.value} ${basketInfo.graph.value}");

        infoToCombine.push( orderLines );
        
        joinResults( ...infoToCombine )
          .forEach( (line) => allOrderLines.push(line) )
      }

      const fields = [
        "plu",
        "aantalPakjes",
        "besteldStuks",
        "besteldGram",
        "basket",
        "name",
        "address",
        "phone",
        "email",
        "streetAddress",
        "postalCode",
        "locality",
        "user",
        "lastChange",
        "hasCustomDeliveryPlace",
        "deliveryType",
        "deliveryPlace",
        "orderLine",
        "comment",
        "totalPrice",
        "route",
        // New
        "status",
        "deliveryPlaceUri",
        "routeUri",
        "deliveryAddress",
        "companyInfo",
        "userAddress",
      ];

      res
        .status(200)
        .send(bindingsAndHeadersAsCsv( allOrderLines, fields ));
    } catch (e) {
    console.log(e);
    }
  } else {
    console.error("Not an admin user, cannot make export");
    res
      .status(403)
      .send(JSON.stringify(
        {errors: [{code: "403", message: "Forbidden, not administrator"}]}))
  }
} );

app.use(errorHandler);
