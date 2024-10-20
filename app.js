// import { query } from 'mu';emtech/mu-javascript-template for more info
import { app, query, errorHandler, sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { isAdminUser } from './lib/authorization'

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

/**
 * Converts query bindings to a raw csv table
 */
function bindingsAsCsv(bindings) {
  if( bindings.length > 0 ) {
    const unpackedBindings =
      bindings
        .map((binding) => {
          const unpacked = {};
          for( let key in binding ) {
            unpacked[key] = binding[key].value;
          }
          return unpacked;
        });

    const csvConfig = mkConfig({ useKeysAsHeaders: true });
    const generator = generateCsv(csvConfig);
    return asString( generator(unpackedBindings) );
  } else {
    return "";
  }
}

app.get('/changed', async function( req, res ) {
  // Yields the baskets which have changed status
  if( await isAdminUser( req ) ) {
    try {
      const { from, to } = reqDates( req );
      // TODO: accept various ways of supplying delivery information
      const response = await query(`
      PREFIX veeakker: <http://veeakker.be/vocabularies/shop/>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      SELECT DISTINCT ?graph ?basket ?date ?status
      WHERE {
        GRAPH ?graph {
          ?basket
            a veeakker:Basket;
            veeakker:statusChangedAt ?date;
            veeakker:basketOrderStatus ?status.
          ${ from ? `FILTER( ?date >= ${sparqlEscapeDateTime(from)} )` : "" }
          ${ to ? `FILTER( ?date <= ${sparqlEscapeDateTime(to) })` : "" }
        }
      } ORDER BY DESC(?date)
     `, { sudo: true });
      res
        .status(200)
        .send( bindingsAsCsv(response.results.bindings) );
    } catch (e) {
      console.log(e);
    }
  } else {
    res.status(403).send(JSON.stringify({errors: [{code: "403", message: "Forbidden, not administrator"}]}));
  }
});

app.get('/baskets', async function( req, res ) {
  if( isAdminUser(req) ) {
    try {
      const { from, to } = reqDates( req );
      const basketStatus = req.query.status
        ? BASKET_STATUS_MAPPING[req.query.status]
        : BASKET_STATUS_MAPPING["confirmed"];

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
  
        SELECT DISTINCT ?plu ?aantalPakjes ?totalPrice (?pStuks AS ?besteldStuks) (?pGrm AS ?besteldGram) ?basket (CONCAT(?firstName, " ", ?lastName) AS ?name) ?address ?phone ?email ?streetAddress ?postalCode ?locality ?user ?lastChange ?hasCustomDeliveryPlace ?deliveryType ?deliveryPlace ?orderLine
        WHERE {
          GRAPH ?g {
            ?basket mu:uuid ?basketUuid;
              veeakker:basketOrderStatus ${sparqlEscapeUri(basketStatus)};
              veeakker:statusChangedAt ?date.
            ${ from ? `FILTER( ?date >= ${sparqlEscapeDateTime(from)})` : "" }
            ${ to ? `FILTER( ?date <= ${sparqlEscapeDateTime(to)})` : "" }
            ?basket veeakker:orderLine ?orderLine.
            ?orderLine veeakker:amount ?aantalPakjes.
            ?orderLine veeakker:hasOffering ?offering.
            OPTIONAL { ?basket veeakker:invoiceAddress ?invoiceAddress. }
            {
              FILTER( bound( ?invoiceAddress ) )
              ?basket veeakker:invoiceAddress ?address.
              OPTIONAL {
                ?address
                  foaf:firstName ?firstName;
                  foaf:lastName ?lastName;
                  foaf:phone ?phone;
                  schema:email ?email;
                  schema:hasAddress ?postal.
                ?postal
                  schema:addressLocality ?locality;
                  schema:postalCode ?postalCode;
                  schema:streetAddress ?streetAddress.
                OPTIONAL { ?address ext:companyInfo ?company. }
              }
            } UNION {
              FILTER( ! bound( ?invoiceAddress ) )
              ?user veeakker:hasBasket ?basket.
              OPTIONAL {
                ?user
                  (foaf:email | schema:email) ?email; # TODO: convert to schema
                  foaf:firstName ?firstName;
                  foaf:lastName ?lastName;
                  foaf:phone ?phone.
              }
              OPTIONAL {
                ?user schema:postalAddress ?address.
                ?address
                  schema:addressLocality ?locality;
                  schema:postalCode ?postalCode;
                  schema:streetAddress ?streetAddress.
                }
              }
              OPTIONAL {
                ?basket veeakker:statusChangedAt ?lastChange.
              }
              OPTIONAL {
                ?basket veeakker:hasCustomDeliveryPlace ?hasCustomDeliveryPlace.
              }
              OPTIONAL {
                ?basket veeakker:deliveryType ?deliveryType.
              }
              OPTIONAL {
                ?basket veeakker:deliveryPlace ?deliveryPlace.
              }
            }
            GRAPH <http://mu.semte.ch/graphs/public> {
              ?offering gr:hasPriceSpecification ?priceSpecification.
              ?offering gr:includesObject ?typeAndQuantity.
              ?priceSpecification gr:hasCurrencyValue ?totalPrice.
              ?typeAndQuantity gr:typeOfGood ?product.
              ?product adms:identifier ?plu.
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
          } ORDER BY ?deliveryType ?deliveryPlace ?user ?basket ?plu
     `, { sudo: true });
      res
        .status(200)
        .send( bindingsAsCsv(response.results.bindings) );
    } catch (e) {
    console.log(e);
    }
  }
} );

app.use(errorHandler);
